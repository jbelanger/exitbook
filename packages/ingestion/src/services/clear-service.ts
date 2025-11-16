import type { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import type { Account } from '@exitbook/core';
import type { AccountRepository, TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IDataSourceRepository, IRawDataRepository } from '../types/repositories.js';

import type { ClearServiceParams, DeletionPreview, ResolvedAccount } from './clear-service-utils.js';
import {
  calculateTotalDeletionItems,
  extractAccountIds,
  resolveAccountsForClear,
  validateClearParams,
} from './clear-service-utils.js';

const logger = getLogger('ClearService');

/**
 * Result of the clear operation
 */
export interface ClearResult {
  deleted: DeletionPreview;
}

/**
 * Clear service - handles data deletion operations.
 * Imperative shell that orchestrates repositories and pure functions.
 */
export class ClearService {
  constructor(
    private accountRepo: AccountRepository,
    private transactionRepo: TransactionRepository,
    private transactionLinkRepo: TransactionLinkRepository,
    private costBasisRepo: CostBasisRepository,
    private lotTransferRepo: LotTransferRepository,
    private rawDataRepo: IRawDataRepository,
    private dataSourceRepo: IDataSourceRepository
  ) {}

  /**
   * Preview what will be deleted.
   */
  async previewDeletion(params: ClearServiceParams): Promise<Result<DeletionPreview, Error>> {
    try {
      // Validate params
      const validation = validateClearParams(params);
      if (!validation.valid) {
        return err(new Error(validation.error));
      }

      // Resolve accounts (imperative - fetches from DB)
      const accountsResult = await this.resolveAccounts(params);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }
      const accountsToClear = accountsResult.value;

      // Count what will be deleted
      if (accountsToClear.length > 0) {
        // Account-scoped deletion
        const accountIds = extractAccountIds(accountsToClear);

        // Get all data_source_ids for these accounts in a single query (avoids N+1)
        const dataSourceIdsResult = await this.dataSourceRepo.getDataSourceIdsByAccounts(accountIds);
        if (dataSourceIdsResult.isErr()) {
          return err(dataSourceIdsResult.error);
        }
        const dataSourceIds = dataSourceIdsResult.value;

        // Only count sessions and rawData if includeRaw is true (otherwise they won't be deleted)
        let sessionsCount = 0;
        let rawDataCount = 0;

        if (params.includeRaw) {
          const sessionsResult = await this.dataSourceRepo.countByAccount(accountIds);
          if (sessionsResult.isErr()) {
            return err(sessionsResult.error);
          }
          sessionsCount = sessionsResult.value;

          const rawDataResult = await this.rawDataRepo.countByAccount(accountIds);
          if (rawDataResult.isErr()) {
            return err(rawDataResult.error);
          }
          rawDataCount = rawDataResult.value;
        }

        const transactionsResult = await this.transactionRepo.countByDataSourceIds(dataSourceIds);
        if (transactionsResult.isErr()) {
          return err(transactionsResult.error);
        }

        const linksResult = await this.transactionLinkRepo.countByDataSourceIds(dataSourceIds);
        if (linksResult.isErr()) {
          return err(linksResult.error);
        }

        const lotsResult = await this.costBasisRepo.countLotsByDataSourceIds(dataSourceIds);
        if (lotsResult.isErr()) {
          return err(lotsResult.error);
        }

        const disposalsResult = await this.costBasisRepo.countDisposalsByDataSourceIds(dataSourceIds);
        if (disposalsResult.isErr()) {
          return err(disposalsResult.error);
        }

        const transfersResult = await this.lotTransferRepo.countByDataSourceIds(dataSourceIds);
        if (transfersResult.isErr()) {
          return err(transfersResult.error);
        }

        const calculationsResult = await this.costBasisRepo.countCalculationsByDataSourceIds(dataSourceIds);
        if (calculationsResult.isErr()) {
          return err(calculationsResult.error);
        }

        return ok({
          calculations: calculationsResult.value,
          disposals: disposalsResult.value,
          links: linksResult.value,
          lots: lotsResult.value,
          rawData: rawDataCount,
          sessions: sessionsCount,
          transfers: transfersResult.value,
          transactions: transactionsResult.value,
        });
      } else {
        // Delete all - use repository count methods
        // Only count sessions and rawData if includeRaw is true (otherwise they won't be deleted)
        let sessionsCount = 0;
        let rawDataCount = 0;

        if (params.includeRaw) {
          const sessionsResult = await this.dataSourceRepo.countAll();
          if (sessionsResult.isErr()) {
            return err(sessionsResult.error);
          }
          sessionsCount = sessionsResult.value;

          const rawDataResult = await this.rawDataRepo.countAll();
          if (rawDataResult.isErr()) {
            return err(rawDataResult.error);
          }
          rawDataCount = rawDataResult.value;
        }

        const transactionsResult = await this.transactionRepo.countAll();
        if (transactionsResult.isErr()) {
          return err(transactionsResult.error);
        }

        const linksResult = await this.transactionLinkRepo.countAll();
        if (linksResult.isErr()) {
          return err(linksResult.error);
        }

        const lotsResult = await this.costBasisRepo.countAllLots();
        if (lotsResult.isErr()) {
          return err(lotsResult.error);
        }

        const disposalsResult = await this.costBasisRepo.countAllDisposals();
        if (disposalsResult.isErr()) {
          return err(disposalsResult.error);
        }

        const transfersResult = await this.lotTransferRepo.countAll();
        if (transfersResult.isErr()) {
          return err(transfersResult.error);
        }

        const calculationsResult = await this.costBasisRepo.countAllCalculations();
        if (calculationsResult.isErr()) {
          return err(calculationsResult.error);
        }

        return ok({
          calculations: calculationsResult.value,
          disposals: disposalsResult.value,
          links: linksResult.value,
          lots: lotsResult.value,
          rawData: rawDataCount,
          sessions: sessionsCount,
          transfers: transfersResult.value,
          transactions: transactionsResult.value,
        });
      }
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Execute the clear operation.
   */
  async execute(params: ClearServiceParams): Promise<Result<ClearResult, Error>> {
    try {
      // Validate params
      const validation = validateClearParams(params);
      if (!validation.valid) {
        return err(new Error(validation.error));
      }

      logger.info(
        { includeRaw: params.includeRaw, source: params.source, accountId: params.accountId },
        'Starting data clearing'
      );

      const preview = await this.previewDeletion(params);
      if (preview.isErr()) {
        return err(preview.error);
      }

      // Check if there's anything to delete (pure function)
      const totalItems = calculateTotalDeletionItems(preview.value);
      if (totalItems === 0) {
        return ok({ deleted: preview.value });
      }

      // Resolve accounts to clear
      const accountsResult = await this.resolveAccounts(params);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }
      const accountsToClear = accountsResult.value;

      // Delete in correct order (respecting FK constraints)
      if (accountsToClear.length > 0) {
        const deleteResult = await this.deleteForAccounts(accountsToClear, params.includeRaw);
        if (deleteResult.isErr()) {
          return err(deleteResult.error);
        }
      } else {
        const deleteResult = await this.deleteAll(params.includeRaw);
        if (deleteResult.isErr()) {
          return err(deleteResult.error);
        }
      }

      logger.info({ deleted: preview.value }, 'Data clearing completed');

      return ok({ deleted: preview.value });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Delete data for specific accounts.
   */
  private async deleteForAccounts(
    accountsToClear: ResolvedAccount[],
    includeRaw: boolean
  ): Promise<Result<void, Error>> {
    const accountIds = extractAccountIds(accountsToClear);

    // Get all data_source_ids (import session IDs) for these accounts in a single query (avoids N+1)
    const dataSourceIdsResult = await this.dataSourceRepo.getDataSourceIdsByAccounts(accountIds);
    if (dataSourceIdsResult.isErr()) {
      return err(dataSourceIdsResult.error);
    }
    const dataSourceIds = dataSourceIdsResult.value;

    // Delete cost basis and transaction data by data_source_id (NOT source_id)
    // This ensures we only delete data for the specific accounts being cleared
    const disposalsResult = await this.costBasisRepo.deleteDisposalsByDataSourceIds(dataSourceIds);
    if (disposalsResult.isErr()) {
      return err(disposalsResult.error);
    }

    const transfersResult = await this.lotTransferRepo.deleteByDataSourceIds(dataSourceIds);
    if (transfersResult.isErr()) {
      return err(transfersResult.error);
    }

    const lotsResult = await this.costBasisRepo.deleteLotsByDataSourceIds(dataSourceIds);
    if (lotsResult.isErr()) {
      return err(lotsResult.error);
    }

    const calculationsResult = await this.costBasisRepo.deleteCalculationsByDataSourceIds(dataSourceIds);
    if (calculationsResult.isErr()) {
      return err(calculationsResult.error);
    }

    const linksResult = await this.transactionLinkRepo.deleteByDataSourceIds(dataSourceIds);
    if (linksResult.isErr()) {
      return err(linksResult.error);
    }

    const transactionsResult = await this.transactionRepo.deleteByDataSourceIds(dataSourceIds);
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    // Delete raw data and sessions (by account_id)
    for (const { account } of accountsToClear) {
      if (includeRaw) {
        const rawDataResult = await this.rawDataRepo.deleteByAccount(account.id);
        if (rawDataResult.isErr()) {
          return err(rawDataResult.error);
        }

        const dataSourceResult = await this.dataSourceRepo.deleteByAccount(account.id);
        if (dataSourceResult.isErr()) {
          return err(dataSourceResult.error);
        }
      } else {
        // Reset raw data processing_status to 'pending' for reprocessing
        const resetResult = await this.rawDataRepo.resetProcessingStatusByAccount(account.id);
        if (resetResult.isErr()) {
          return err(resetResult.error);
        }
      }
    }

    return ok();
  }

  /**
   * Delete all data.
   */
  private async deleteAll(includeRaw: boolean): Promise<Result<void, Error>> {
    const disposalsResult = await this.costBasisRepo.deleteAllDisposals();
    if (disposalsResult.isErr()) {
      return err(disposalsResult.error);
    }

    const transfersResult = await this.lotTransferRepo.deleteAll();
    if (transfersResult.isErr()) {
      return err(transfersResult.error);
    }

    const lotsResult = await this.costBasisRepo.deleteAllLots();
    if (lotsResult.isErr()) {
      return err(lotsResult.error);
    }

    const calculationsResult = await this.costBasisRepo.deleteAllCalculations();
    if (calculationsResult.isErr()) {
      return err(calculationsResult.error);
    }

    const linksResult = await this.transactionLinkRepo.deleteAll();
    if (linksResult.isErr()) {
      return err(linksResult.error);
    }

    const transactionsResult = await this.transactionRepo.deleteAll();
    if (transactionsResult.isErr()) {
      return err(transactionsResult.error);
    }

    if (includeRaw) {
      const rawDataResult = await this.rawDataRepo.deleteAll();
      if (rawDataResult.isErr()) {
        return err(rawDataResult.error);
      }

      const dataSourceResult = await this.dataSourceRepo.deleteAll();
      if (dataSourceResult.isErr()) {
        return err(dataSourceResult.error);
      }
    } else {
      // Reset raw data processing_status to 'pending' for reprocessing
      const resetResult = await this.rawDataRepo.resetProcessingStatusAll();
      if (resetResult.isErr()) {
        return err(resetResult.error);
      }
    }

    return ok();
  }

  /**
   * Resolve accounts to clear based on params.
   * Imperative - fetches from repositories.
   */
  private async resolveAccounts(params: ClearServiceParams): Promise<Result<ResolvedAccount[], Error>> {
    let accountById;
    let accountsBySource: Account[] = [];

    if (params.accountId) {
      const result = await this.accountRepo.findById(params.accountId);
      if (result.isErr()) {
        return err(result.error);
      }
      accountById = result.value;
    }

    if (params.source) {
      const result = await this.accountRepo.findBySourceName(params.source);
      if (result.isErr()) {
        return err(result.error);
      }
      accountsBySource = result.value;
    }

    // Use pure function to determine accounts
    const resolved = resolveAccountsForClear(params, accountById, accountsBySource);
    return ok(resolved);
  }
}

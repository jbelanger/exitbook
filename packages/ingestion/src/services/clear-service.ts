import type { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import type { Account } from '@exitbook/core';
import type {
  AccountRepository,
  IImportSessionRepository,
  IRawDataRepository,
  TransactionRepository,
  UserRepository,
} from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

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
    private userRepo: UserRepository,
    private accountRepo: AccountRepository,
    private transactionRepo: TransactionRepository,
    private transactionLinkRepo: TransactionLinkRepository,
    private costBasisRepo: CostBasisRepository,
    private lotTransferRepo: LotTransferRepository,
    private rawDataRepo: IRawDataRepository,
    private sessionRepo: IImportSessionRepository
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

      // If filters were provided but matched no accounts, return error to prevent accidental deletion
      const filtersProvided = params.accountId !== undefined || params.source !== undefined;
      if (filtersProvided && accountsToClear.length === 0) {
        return err(
          new Error(
            `No accounts matched the provided filters (${params.accountId ? `accountId=${params.accountId}` : ''}${params.accountId && params.source ? ', ' : ''}${params.source ? `source=${params.source}` : ''}). No data deleted.`
          )
        );
      }

      // Count what will be deleted
      if (accountsToClear.length > 0) {
        // Account-scoped deletion
        const accountIds = extractAccountIds(accountsToClear);

        // Only count sessions and rawData if includeRaw is true (otherwise they won't be deleted)
        let sessionsCount = 0;
        let rawDataCount = 0;

        if (params.includeRaw) {
          const sessionsResult = await this.sessionRepo.countByAccount(accountIds);
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

        const transactionsResult = await this.transactionRepo.countByAccountIds(accountIds);
        if (transactionsResult.isErr()) {
          return err(transactionsResult.error);
        }

        const linksResult = await this.transactionLinkRepo.countByAccountIds(accountIds);
        if (linksResult.isErr()) {
          return err(linksResult.error);
        }

        const lotsResult = await this.costBasisRepo.countLotsByAccountIds(accountIds);
        if (lotsResult.isErr()) {
          return err(lotsResult.error);
        }

        const disposalsResult = await this.costBasisRepo.countDisposalsByAccountIds(accountIds);
        if (disposalsResult.isErr()) {
          return err(disposalsResult.error);
        }

        const transfersResult = await this.lotTransferRepo.countByAccountIds(accountIds);
        if (transfersResult.isErr()) {
          return err(transfersResult.error);
        }

        const calculationsResult = await this.costBasisRepo.countCalculationsByAccountIds(accountIds);
        if (calculationsResult.isErr()) {
          return err(calculationsResult.error);
        }

        return ok({
          accounts: accountsToClear.length,
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
          const sessionsResult = await this.sessionRepo.countAll();
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

        // For delete-all, we don't delete accounts (they remain for future imports)
        return ok({
          accounts: 0,
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

      // If filters were provided but matched no accounts, return error to prevent accidental deletion
      const filtersProvided = params.accountId !== undefined || params.source !== undefined;
      if (filtersProvided && accountsToClear.length === 0) {
        return err(
          new Error(
            `No accounts matched the provided filters (${params.accountId ? `accountId=${params.accountId}` : ''}${params.accountId && params.source ? ', ' : ''}${params.source ? `source=${params.source}` : ''}). No data deleted.`
          )
        );
      }

      // Delete in correct order (respecting FK constraints)
      if (accountsToClear.length > 0) {
        const deleteResult = await this.deleteForAccounts(accountsToClear, params.includeRaw);
        if (deleteResult.isErr()) {
          return err(deleteResult.error);
        }
      } else {
        // Only delete all if no filters were provided (explicit delete-all request)
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

    // Delete cost basis and transaction data by account_id
    // This ensures we only delete data for the specific accounts being cleared
    const disposalsResult = await this.costBasisRepo.deleteDisposalsByAccountIds(accountIds);
    if (disposalsResult.isErr()) {
      return err(disposalsResult.error);
    }

    const transfersResult = await this.lotTransferRepo.deleteByAccountIds(accountIds);
    if (transfersResult.isErr()) {
      return err(transfersResult.error);
    }

    const lotsResult = await this.costBasisRepo.deleteLotsByAccountIds(accountIds);
    if (lotsResult.isErr()) {
      return err(lotsResult.error);
    }

    const calculationsResult = await this.costBasisRepo.deleteCalculationsByAccountIds(accountIds);
    if (calculationsResult.isErr()) {
      return err(calculationsResult.error);
    }

    const linksResult = await this.transactionLinkRepo.deleteByAccountIds(accountIds);
    if (linksResult.isErr()) {
      return err(linksResult.error);
    }

    const transactionsResult = await this.transactionRepo.deleteByAccountIds(accountIds);
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

        const importSessionResult = await this.sessionRepo.deleteByAccount(account.id);
        if (importSessionResult.isErr()) {
          return err(importSessionResult.error);
        }
      } else {
        // Reset raw data processing_status to 'pending' for reprocessing
        const resetResult = await this.rawDataRepo.resetProcessingStatusByAccount(account.id);
        if (resetResult.isErr()) {
          return err(resetResult.error);
        }
      }
    }

    // Delete the accounts themselves (after all data that references them)
    const deleteAccountsResult = await this.accountRepo.deleteByIds(accountIds);
    if (deleteAccountsResult.isErr()) {
      return err(deleteAccountsResult.error);
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

      const importSessionResult = await this.sessionRepo.deleteAll();
      if (importSessionResult.isErr()) {
        return err(importSessionResult.error);
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
   * Scoped to default user to prevent accidental cross-user data deletion.
   */
  private async resolveAccounts(params: ClearServiceParams): Promise<Result<ResolvedAccount[], Error>> {
    // 1. Ensure default user exists (id=1)
    const userResult = await this.userRepo.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    let accountById;
    let accountsBySource: Account[] = [];

    // 2. Find accounts scoped to this user
    if (params.accountId) {
      // Use findAll with userId filter to ensure user scoping
      const result = await this.accountRepo.findAll({ userId: user.id });
      if (result.isErr()) {
        return err(result.error);
      }
      // Find the specific account by ID within this user's accounts
      accountById = result.value.find((acc) => acc.id === params.accountId);
      if (!accountById) {
        return err(new Error(`Account ${params.accountId} not found for user ${user.id}`));
      }
    }

    if (params.source) {
      // Use findAll with userId and sourceName filters
      const result = await this.accountRepo.findAll({
        userId: user.id,
        sourceName: params.source,
      });
      if (result.isErr()) {
        return err(result.error);
      }
      accountsBySource = result.value;
    }

    // 3. Use pure function to determine accounts
    const resolved = resolveAccountsForClear(params, accountById, accountsBySource);
    return ok(resolved);
  }
}

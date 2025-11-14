import type { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import type { Account } from '@exitbook/core';
import type { AccountRepository, KyselyDB, TransactionRepository } from '@exitbook/data';
import type { DataSourceRepository, RawDataRepository } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ClearHandlerParams, DeletionPreview } from './clear-utils.js';

const logger = getLogger('ClearHandler');

/**
 * Result of the clear operation.
 */
export interface ClearResult {
  deleted: DeletionPreview;
}

/**
 * Clear handler - encapsulates all clear business logic.
 * Uses repositories to perform database operations.
 */
export class ClearHandler {
  constructor(
    private db: KyselyDB,
    private accountRepo: AccountRepository,
    private transactionRepo: TransactionRepository,
    private transactionLinkRepo: TransactionLinkRepository,
    private costBasisRepo: CostBasisRepository,
    private lotTransferRepo: LotTransferRepository,
    private rawDataRepo: RawDataRepository,
    private dataSourceRepo: DataSourceRepository
  ) {}

  /**
   * Preview what will be deleted.
   */
  async previewDeletion(params: ClearHandlerParams): Promise<Result<DeletionPreview, Error>> {
    try {
      // Resolve accounts if filtering by account/source
      const accountsResult = await this.resolveAccounts(params);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }
      const accountsToClear = accountsResult.value;

      // Helper to count rows in a table
      const countTable = async (tableName: string): Promise<number> => {
        const result = await this.db
          .selectFrom(tableName as 'import_sessions')
          .select(({ fn }) => [fn.count<number>('id').as('count')])
          .executeTakeFirst();
        return result?.count ?? 0;
      };

      // Helper to count rows filtered by source_id (for transactions, etc.)
      const countBySource = async (tableName: string, sourceIds: string[]): Promise<number> => {
        if (sourceIds.length === 0) return 0;
        const result = await this.db
          .selectFrom(tableName as 'transactions')
          .select(({ fn }) => [fn.count<number>('id').as('count')])
          .where('source_id', 'in', sourceIds)
          .executeTakeFirst();
        return result?.count ?? 0;
      };

      // Helper to count rows filtered by account_id (for sessions, raw data)
      const countByAccount = async (tableName: string, accountIds: number[]): Promise<number> => {
        if (accountIds.length === 0) return 0;
        const result = await this.db
          .selectFrom(tableName as 'import_sessions')
          .select(({ fn }) => [fn.count<number>('id').as('count')])
          .where('account_id', 'in', accountIds)
          .executeTakeFirst();
        return result?.count ?? 0;
      };

      let sessions = 0;
      let rawData = 0;
      let transactions = 0;
      let links = 0;
      let lots = 0;
      let disposals = 0;
      let transfers = 0;
      let calculations = 0;

      if (accountsToClear.length > 0) {
        // Filter by specific accounts
        const accountIds = accountsToClear.map((a) => a.account.id);
        const sourceIds = [...new Set(accountsToClear.map((a) => a.sourceId))];

        sessions = await countByAccount('import_sessions', accountIds);
        rawData = await countByAccount('external_transaction_data', accountIds);
        transactions = await countBySource('transactions', sourceIds);
        links = await countTable('transaction_links');
        lots = await countBySource('acquisition_lots', sourceIds);
        disposals = await countBySource('lot_disposals', sourceIds);
        transfers = await countTable('lot_transfers');
        calculations = await countTable('cost_basis_calculations');
      } else {
        // Count all
        sessions = await countTable('import_sessions');
        rawData = await countTable('external_transaction_data');
        transactions = await countTable('transactions');
        links = await countTable('transaction_links');
        lots = await countTable('acquisition_lots');
        disposals = await countTable('lot_disposals');
        transfers = await countTable('lot_transfers');
        calculations = await countTable('cost_basis_calculations');
      }

      return ok({
        calculations,
        disposals,
        links,
        lots,
        rawData,
        sessions,
        transfers,
        transactions,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Execute the clear operation.
   */
  async execute(params: ClearHandlerParams): Promise<Result<ClearResult, Error>> {
    try {
      logger.info(
        { includeRaw: params.includeRaw, source: params.source, accountId: params.accountId },
        'Starting data clearing'
      );

      const preview = await this.previewDeletion(params);
      if (preview.isErr()) {
        return err(preview.error);
      }

      // If there's nothing to delete, return early
      const totalItems =
        preview.value.sessions +
        preview.value.rawData +
        preview.value.transactions +
        preview.value.links +
        preview.value.lots +
        preview.value.disposals +
        preview.value.transfers +
        preview.value.calculations;

      if (totalItems === 0) {
        return ok({
          deleted: preview.value,
        });
      }

      // Resolve accounts to clear
      const accountsResult = await this.resolveAccounts(params);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }

      const accountsToClear = accountsResult.value;

      // Delete in correct order (respecting FK constraints)
      if (accountsToClear.length > 0) {
        // Delete for specific account(s)
        const sourceIds = [...new Set(accountsToClear.map((a) => a.sourceId))];

        // Delete cost basis data (by source_id from transactions)
        for (const sourceId of sourceIds) {
          const disposalsResult = await this.costBasisRepo.deleteDisposalsBySource(sourceId);
          if (disposalsResult.isErr()) {
            return err(disposalsResult.error);
          }

          const lotsResult = await this.costBasisRepo.deleteLotsBySource(sourceId);
          if (lotsResult.isErr()) {
            return err(lotsResult.error);
          }

          const linksResult = await this.transactionLinkRepo.deleteBySource(sourceId);
          if (linksResult.isErr()) {
            return err(linksResult.error);
          }

          const transactionsResult = await this.transactionRepo.deleteBySource(sourceId);
          if (transactionsResult.isErr()) {
            return err(transactionsResult.error);
          }
        }

        // Delete raw data and sessions (by account_id)
        for (const { account } of accountsToClear) {
          if (params.includeRaw) {
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
      } else {
        // Delete all data (except external_transaction_data and import_sessions)
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

        if (params.includeRaw) {
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
      }

      logger.info(
        {
          deleted: preview.value,
        },
        'Data clearing completed'
      );

      return ok({
        deleted: preview.value,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    // No resources to cleanup
  }

  /**
   * Resolve accounts to clear based on params.
   * Returns array of accounts and their corresponding source IDs.
   */
  private async resolveAccounts(
    params: ClearHandlerParams
  ): Promise<Result<{ account: Account; sourceId: string }[], Error>> {
    if (params.accountId) {
      const accountResult = await this.accountRepo.findById(params.accountId);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }
      return ok([{ account: accountResult.value, sourceId: accountResult.value.sourceName }]);
    }

    if (params.source) {
      const accountsResult = await this.accountRepo.findBySourceName(params.source);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }
      return ok(accountsResult.value.map((account) => ({ account, sourceId: account.sourceName })));
    }

    return ok([]);
  }
}

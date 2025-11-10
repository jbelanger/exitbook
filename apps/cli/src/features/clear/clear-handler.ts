import type { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import type { KyselyDB, TransactionRepository } from '@exitbook/data';
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
      const countTable = async (tableName: string, sourceFilter?: boolean): Promise<number> => {
        if (sourceFilter && params.source) {
          const result = await this.db
            .selectFrom(tableName as 'data_sources')
            .select(({ fn }) => [fn.count<number>('id').as('count')])
            .where('source_id', '=', params.source)
            .executeTakeFirst();
          return result?.count ?? 0;
        }
        const result = await this.db
          .selectFrom(tableName as 'data_sources')
          .select(({ fn }) => [fn.count<number>('id').as('count')])
          .executeTakeFirst();
        return result?.count ?? 0;
      };

      const sessions = await countTable('data_sources', true);
      const rawData = await countTable('external_transaction_data', false);
      const transactions = await countTable('transactions', true);
      const links = await countTable('transaction_links', false);
      const lots = await countTable('acquisition_lots', false);
      const disposals = await countTable('lot_disposals', false);
      const transfers = await countTable('lot_transfers', false);
      const calculations = await countTable('cost_basis_calculations', false);

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
      logger.info({ includeRaw: params.includeRaw, source: params.source }, 'Starting data clearing');

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

      // Delete in correct order (respecting FK constraints)
      if (params.source) {
        // Delete for specific source
        const disposalsResult = await this.costBasisRepo.deleteDisposalsBySource(params.source);
        if (disposalsResult.isErr()) {
          return err(disposalsResult.error);
        }

        // Note: Cannot delete lot_transfers by source directly as they don't have source_id
        // For now, we'll skip lot_transfers deletion for source-specific clears
        // This is acceptable as lot_transfers are part of cost basis calculations

        const lotsResult = await this.costBasisRepo.deleteLotsBySource(params.source);
        if (lotsResult.isErr()) {
          return err(lotsResult.error);
        }

        const linksResult = await this.transactionLinkRepo.deleteBySource(params.source);
        if (linksResult.isErr()) {
          return err(linksResult.error);
        }

        const transactionsResult = await this.transactionRepo.deleteBySource(params.source);
        if (transactionsResult.isErr()) {
          return err(transactionsResult.error);
        }

        if (params.includeRaw) {
          const rawDataResult = await this.rawDataRepo.deleteBySource(params.source);
          if (rawDataResult.isErr()) {
            return err(rawDataResult.error);
          }

          const dataSourceResult = await this.dataSourceRepo.deleteBySource(params.source);
          if (dataSourceResult.isErr()) {
            return err(dataSourceResult.error);
          }
        } else {
          // Reset raw data processing_status to 'pending' for reprocessing
          const resetResult = await this.rawDataRepo.resetProcessingStatusBySource(params.source);
          if (resetResult.isErr()) {
            return err(resetResult.error);
          }
        }
      } else {
        // Delete all data (except external_transaction_data and data_sources)
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
}

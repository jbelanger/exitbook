import type { KyselyDB } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { ClearHandlerParams, DeletionPreview } from './clear-utils.ts';

const logger = getLogger('ClearHandler');

/**
 * Result of the clear operation.
 */
export interface ClearResult {
  deleted: DeletionPreview;
}

/**
 * Clear handler - encapsulates all clear business logic.
 */
export class ClearHandler {
  constructor(private database: KyselyDB) {}

  /**
   * Preview what will be deleted.
   */
  async previewDeletion(params: ClearHandlerParams): Promise<Result<DeletionPreview, Error>> {
    try {
      const countTable = async (tableName: string, sourceFilter?: boolean): Promise<number> => {
        if (sourceFilter && params.source) {
          const result = await this.database
            .selectFrom(tableName as 'import_sessions')
            .select(({ fn }) => [fn.count<number>('id').as('count')])
            .where('source_id', '=', params.source)
            .executeTakeFirst();
          return result?.count ?? 0;
        }
        const result = await this.database
          .selectFrom(tableName as 'import_sessions')
          .select(({ fn }) => [fn.count<number>('id').as('count')])
          .executeTakeFirst();
        return result?.count ?? 0;
      };

      const sessions = await countTable('import_sessions', true);
      const rawData = await countTable('external_transaction_data', false);
      const transactions = await countTable('transactions', true);
      const links = await countTable('transaction_links', false);
      const lots = await countTable('acquisition_lots', false);
      const disposals = await countTable('lot_disposals', false);
      const calculations = await countTable('cost_basis_calculations', false);

      return ok({
        sessions,
        rawData,
        transactions,
        links,
        lots,
        disposals,
        calculations,
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
      logger.info({ source: params.source, includeRaw: params.includeRaw }, 'Starting data clearing');

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
        preview.value.calculations;

      if (totalItems === 0) {
        return ok({
          deleted: preview.value,
        });
      }

      // Delete in correct order (respecting FK constraints)
      if (params.source) {
        // Delete for specific source
        await this.database
          .deleteFrom('lot_disposals')
          .where('lot_id', 'in', this.database.selectFrom('acquisition_lots').select('id'))
          .execute();

        await this.database
          .deleteFrom('acquisition_lots')
          .where(
            'acquisition_transaction_id',
            'in',
            this.database.selectFrom('transactions').select('id').where('source_id', '=', params.source)
          )
          .execute();

        await this.database
          .deleteFrom('transaction_links')
          .where(
            'source_transaction_id',
            'in',
            this.database.selectFrom('transactions').select('id').where('source_id', '=', params.source)
          )
          .execute();

        await this.database.deleteFrom('transactions').where('source_id', '=', params.source).execute();

        if (params.includeRaw) {
          await this.database
            .deleteFrom('external_transaction_data')
            .where(
              'import_session_id',
              'in',
              this.database.selectFrom('import_sessions').select('id').where('source_id', '=', params.source)
            )
            .execute();

          await this.database
            .deleteFrom('import_session_errors')
            .where(
              'import_session_id',
              'in',
              this.database.selectFrom('import_sessions').select('id').where('source_id', '=', params.source)
            )
            .execute();

          await this.database.deleteFrom('import_sessions').where('source_id', '=', params.source).execute();
        }
      } else {
        // Delete all data
        await this.database.deleteFrom('lot_disposals').execute();
        await this.database.deleteFrom('acquisition_lots').execute();
        await this.database.deleteFrom('cost_basis_calculations').execute();
        await this.database.deleteFrom('transaction_links').execute();
        await this.database.deleteFrom('transactions').execute();

        if (params.includeRaw) {
          await this.database.deleteFrom('external_transaction_data').execute();
          await this.database.deleteFrom('import_session_errors').execute();
          await this.database.deleteFrom('import_sessions').execute();
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

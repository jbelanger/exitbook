import type { KyselyDB } from '@exitbook/data';
import type { RawData } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.js';
import type { IRawDataRepository, LoadRawDataFilters } from '@exitbook/import/app/ports/raw-data-repository.js';
import { err, ok, type Result } from 'neverthrow';

/**
 * Kysely-based repository for raw data database operations.
 * Handles storage and retrieval of external transaction data using type-safe queries.
 * All operations return Result types and fail fast on errors.
 */
export class RawDataRepository extends BaseRepository implements IRawDataRepository {
  constructor(db: KyselyDB) {
    super(db, 'RawDataRepository');
  }

  async load(filters?: LoadRawDataFilters): Promise<Result<RawData[], Error>> {
    this.logger.info({ filters }, 'Loading raw data with filters');

    try {
      let query = this.db
        .selectFrom('external_transaction_data')
        .innerJoin('import_sessions', 'external_transaction_data.import_session_id', 'import_sessions.id')
        .selectAll('external_transaction_data');

      // Apply filters
      if (filters?.sourceId) {
        query = query.where('source_id', '=', filters.sourceId);
      }

      if (filters?.importSessionId) {
        query = query.where('import_session_id', '=', filters.importSessionId);
      }

      if (filters?.providerId) {
        query = query.where('provider_id', '=', filters.providerId);
      }

      if (filters?.processingStatus) {
        query = query.where('processing_status', '=', filters.processingStatus);
      }

      if (filters?.since) {
        // Convert Unix timestamp to Date - now type-safe with DateTime type and plugin
        const sinceDate = new Date(filters.since * 1000).toISOString();
        query = query.where('created_at', '>=', sinceDate);
      }

      // Apply ordering
      query = query.orderBy('created_at', 'desc');

      const rows = await query.execute();

      this.logger.info({ count: rows.length }, 'Loaded raw data items');
      return ok(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, filters }, 'Failed to load raw data');
      return err(new Error(`Failed to load raw data: ${errorMessage}`));
    }
  }

  async markAsProcessed(
    sourceId: string,
    rawTransactionIds: number[],
    providerId?: string
  ): Promise<Result<void, Error>> {
    this.logger.info({ count: rawTransactionIds.length, providerId, sourceId }, 'Marking items as processed');

    try {
      await this.withTransaction(async (trx) => {
        const processedAt = this.getCurrentDateTimeForDB();

        for (const id of rawTransactionIds) {
          let updateQuery = trx
            .updateTable('external_transaction_data')
            .set({
              processed_at: processedAt,
              processing_error: undefined,
              processing_status: 'processed',
            })
            .where('id', '=', id);

          // Apply provider filter if specified
          if (providerId) {
            updateQuery = updateQuery.where('provider_id', '=', providerId);
          } else {
            // eslint-disable-next-line unicorn/no-null -- We want to check for NULL in the database
            updateQuery = updateQuery.where('provider_id', 'is', null);
          }

          await updateQuery.execute();
        }
      });

      this.logger.info({ count: rawTransactionIds.length, sourceId }, 'Successfully marked items as processed');
      return ok();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, sourceId, rawTransactionIds }, 'Failed to mark items as processed');
      return err(new Error(`Failed to mark items as processed: ${errorMessage}`));
    }
  }

  async save(
    rawData: unknown,
    importSessionId: number,
    providerId: string,
    metadata?: RawTransactionMetadata
  ): Promise<Result<number, Error>> {
    this.logger.info('Saving raw data item');

    if (!rawData) {
      return err(new Error('Raw data cannot be null or undefined'));
    }

    try {
      const result = await this.withTransaction(async (trx) => {
        const insertResult = await trx
          .insertInto('external_transaction_data')
          .values({
            created_at: this.getCurrentDateTimeForDB(),
            import_session_id: importSessionId,
            metadata: this.serializeToJson(metadata) || undefined,
            processing_status: 'pending',
            provider_id: providerId,
            raw_data: JSON.stringify(rawData),
          })
          .onConflict((oc) => oc.doNothing()) // Equivalent to INSERT OR IGNORE
          .execute();

        return insertResult.length > 0 ? 1 : 0;
      });

      this.logger.info('Successfully saved raw data item');
      return ok(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, rawData, importSessionId, providerId }, 'Failed to save raw data item');
      return err(new Error(`Failed to save raw data item: ${errorMessage}`));
    }
  }

  async saveBatch(
    items: { metadata?: RawTransactionMetadata; providerId: string; rawData: unknown }[],
    importSessionId: number
  ): Promise<Result<number, Error>> {
    this.logger.info({ count: items.length }, 'Saving raw data batch');

    if (items.length === 0) {
      return ok(0);
    }

    // Validate all items before processing
    for (const item of items) {
      if (!item.rawData) {
        return err(new Error('Raw data cannot be null or undefined in batch items'));
      }
    }

    try {
      const result = await this.withTransaction(async (trx) => {
        let saved = 0;
        const createdAt = this.getCurrentDateTimeForDB();

        for (const item of items) {
          const insertResult = await trx
            .insertInto('external_transaction_data')
            .values({
              created_at: createdAt,
              import_session_id: importSessionId,
              metadata: this.serializeToJson(item.metadata) || undefined,
              processing_status: 'pending',
              provider_id: item.providerId,
              raw_data: JSON.stringify(item.rawData),
            })
            .onConflict((oc) => oc.doNothing())
            .execute();

          if (insertResult.length > 0) {
            saved++;
          }
        }

        return saved;
      });

      this.logger.info({ count: result, totalItems: items.length }, 'Successfully saved raw data batch');
      return ok(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, items, importSessionId }, 'Failed to save raw data batch');
      return err(new Error(`Failed to save raw data batch: ${errorMessage}`));
    }
  }
}

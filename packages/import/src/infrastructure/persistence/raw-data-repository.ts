import type { KyselyDB } from '@exitbook/data';
import type { RawData } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { IRawDataRepository, LoadRawDataFilters } from '@exitbook/import/app/ports/raw-data-repository.js';

/**
 * Kysely-based repository for raw data database operations.
 * Handles storage and retrieval of external transaction data using type-safe queries.
 */
export class RawDataRepository extends BaseRepository implements IRawDataRepository {
  constructor(db: KyselyDB) {
    super(db, 'RawDataRepository');
  }

  async load(filters?: LoadRawDataFilters): Promise<RawData[]> {
    this.logger.info({ filters }, 'Loading raw data with filters');

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
    return rows;
  }

  async markAsProcessed(sourceId: string, rawTransactionIds: number[], providerId?: string): Promise<void> {
    this.logger.info({ count: rawTransactionIds.length, providerId, sourceId }, 'Marking items as processed');

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
  }

  async save(rawData: unknown, importSessionId: number, providerId: string, metadata?: unknown): Promise<number> {
    this.logger.info('Saving raw data item');

    if (!rawData) {
      return 0;
    }

    return this.withTransaction(async (trx) => {
      let saved = 0;
      try {
        const result = await trx
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

        if (result.length > 0) {
          saved++;
        }
      } catch (error) {
        this.logger.warn({ error, rawData }, 'Failed to save raw data item, continuing with others');
        // Continue with other items instead of failing the entire batch
      }

      this.logger.info('Successfully saved raw data items');

      return saved;
    });
  }

  async updateProcessingStatus(
    rawTransactionId: number,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void> {
    const processedAt = status === 'processed' ? this.getCurrentDateTimeForDB() : undefined;

    let updateQuery = this.db
      .updateTable('external_transaction_data')
      .set({
        processed_at: processedAt,
        processing_error: error,
        processing_status: status,
      })
      .where('id', '=', rawTransactionId);

    // Apply provider condition (handles both specified provider and null provider)
    if (providerId) {
      updateQuery = updateQuery.where('provider_id', '=', providerId);
    } else {
      // eslint-disable-next-line unicorn/no-null -- We want to check for NULL in the database
      updateQuery = updateQuery.where('provider_id', 'is', null);
    }

    await updateQuery.execute();

    this.logger.debug({ providerId, rawTransactionId, status }, 'Updated processing status for raw data item');
  }
}

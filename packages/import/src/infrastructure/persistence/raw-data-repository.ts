import { BaseRepository } from '@crypto/data/src/repositories/base-repository.js';
import type { KyselyDB } from '@crypto/data/src/storage/database.js';
import type { RawData, StoredRawData } from '@crypto/data/src/types/data-types.js';
import type { IRawDataRepository, LoadRawDataFilters } from '@exitbook/import/app/ports/raw-data-repository.js';

/**
 * Maps database row to StoredRawData domain object
 */
function mapToStoredRawData(row: RawData): StoredRawData {
  return {
    createdAt: new Date(row.created_at).getTime() / 1000,
    id: row.id,
    importSessionId: row.import_session_id as number | undefined,
    metadata: (row.metadata ? JSON.parse(row.metadata) : undefined) as {
      providerId: string;
      sourceAddress?: string | undefined;
      transactionType?: string | undefined;
    },
    processedAt: row.processed_at ? new Date(row.processed_at).getTime() / 1000 : undefined,
    processingError: row.processing_error as string | undefined,
    processingStatus: (row.processing_status as string) ?? 'pending',
    providerId: row.provider_id as string | undefined,
    rawData: JSON.parse(row.raw_data),
  };
}

/**
 * Kysely-based repository for raw data database operations.
 * Handles storage and retrieval of external transaction data using type-safe queries.
 */
export class RawDataRepository extends BaseRepository implements IRawDataRepository {
  constructor(db: KyselyDB) {
    super(db, 'RawDataRepository');
  }

  async load(filters?: LoadRawDataFilters): Promise<StoredRawData[]> {
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
    const results = rows.map(mapToStoredRawData);

    this.logger.info({ count: results.length }, 'Loaded raw data items');
    return results;
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

  async save(
    sourceId: string,
    sourceType: string,
    rawData: { data: unknown }[],
    importSessionId: number,
    providerId: string,
    metadata?: unknown
  ): Promise<number> {
    this.logger.info({ count: rawData.length, sourceId }, 'Saving raw data items');

    if (rawData.length === 0) {
      return 0;
    }

    return this.withTransaction(async (trx) => {
      let saved = 0;

      for (const rawTx of rawData) {
        try {
          const result = await trx
            .insertInto('external_transaction_data')
            .values({
              created_at: this.getCurrentDateTimeForDB(),
              import_session_id: importSessionId,
              metadata: this.serializeToJson(metadata) || undefined,
              processing_status: 'pending',
              provider_id: providerId,
              raw_data: JSON.stringify(rawTx.data),
            })
            .onConflict((oc) => oc.doNothing()) // Equivalent to INSERT OR IGNORE
            .execute();

          if (result.length > 0) {
            saved++;
          }
        } catch (error) {
          this.logger.warn({ error, rawTx, sourceId }, 'Failed to save raw data item, continuing with others');
          // Continue with other items instead of failing the entire batch
        }
      }

      this.logger.info({ saved, sourceId, total: rawData.length }, 'Successfully saved raw data items');

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

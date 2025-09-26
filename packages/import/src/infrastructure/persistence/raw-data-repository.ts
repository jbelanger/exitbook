import type { StoredRawData } from '@crypto/data/src/types/data-types.ts';
import { getLogger } from '@crypto/shared-logger';
import type sqlite3Module from 'sqlite3';

import type {
  IRawDataRepository,
  LoadRawDataFilters,
  SaveRawDataOptions,
} from '../../app/ports/raw-data-repository.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

/**
 * Database implementation of IRawDataRepository.
 * Manages raw external transaction data storage and retrieval.
 */
export class RawDataRepository implements IRawDataRepository {
  private logger = getLogger('RawDataRepository');

  constructor(private db: SQLiteDatabase) {}

  async load(filters?: LoadRawDataFilters): Promise<StoredRawData[]> {
    this.logger.info(`Loading raw data with filters: ${JSON.stringify(filters)}`);

    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM external_transaction_data';
      const params: (string | number)[] = [];
      const conditions: string[] = [];

      if (filters?.sourceId) {
        conditions.push('source_id = ?');
        params.push(filters.sourceId);
      }

      if (filters?.importSessionId) {
        conditions.push('import_session_id = ?');
        params.push(filters.importSessionId);
      }

      if (filters?.providerId) {
        conditions.push('provider_id = ?');
        params.push(filters.providerId);
      }

      if (filters?.processingStatus) {
        conditions.push('processing_status = ?');
        params.push(filters.processingStatus);
      }

      if (filters?.since) {
        conditions.push('created_at >= ?');
        params.push(filters.since);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC';

      this.db.all(query, params, (err, rows: unknown[]) => {
        if (err) {
          this.logger.error(`Failed to load raw data: ${String(err)}`);
          reject(err);
        } else {
          const results = rows.map((row) => {
            const dbRow = row as Record<string, unknown>;
            return {
              createdAt: dbRow.created_at as number,
              id: dbRow.id as number,
              importSessionId: dbRow.import_session_id ? (dbRow.import_session_id as number) : undefined,
              metadata: dbRow.metadata ? (JSON.parse(dbRow.metadata as string) as Record<string, unknown>) : undefined,
              processedAt: dbRow.processed_at ? (dbRow.processed_at as number) : undefined,
              processingError: dbRow.processing_error ? (dbRow.processing_error as string) : undefined,
              processingStatus: dbRow.processing_status as string,
              providerId: dbRow.provider_id ? (dbRow.provider_id as string) : undefined,
              rawData: JSON.parse(dbRow.raw_data as string) as Record<string, unknown>,
              sourceId: dbRow.source_id as string,
              sourceType: dbRow.source_type as string,
            };
          });
          this.logger.info(`Loaded ${results.length} raw data items`);
          resolve(results);
        }
      });
    });
  }

  async markAsProcessed(sourceId: string, rawTransactionIds: number[], providerId?: string): Promise<void> {
    this.logger.info(`Marking ${rawTransactionIds.length} items as processed for ${sourceId}`);

    try {
      const promises = rawTransactionIds.map((id) =>
        this.updateProcessingStatus(id, 'processed', undefined, providerId)
      );

      await Promise.all(promises);

      this.logger.info(`Successfully marked ${rawTransactionIds.length} items as processed for ${sourceId}`);
    } catch (error) {
      this.logger.error(`Failed to mark items as processed for ${sourceId}: ${String(error)}`);
      throw error;
    }
  }

  async save(
    sourceId: string,
    sourceType: string,
    rawData: { data: unknown }[],
    options?: SaveRawDataOptions
  ): Promise<number> {
    this.logger.info(`Saving ${rawData.length} raw data items for ${sourceId}`);

    return new Promise((resolve, reject) => {
      let saved = 0;
      let completed = 0;
      const total = rawData.length;
      let hasError = false;
      const db = this.db;
      const logger = this.logger;

      if (total === 0) {
        resolve(0);
        return;
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) {
            logger.error(`Failed to begin transaction: ${String(err)}`);
            return reject(err);
          }
        });

        const stmt = db.prepare(`
          INSERT OR IGNORE INTO external_transaction_data
          (source_id, source_type, provider_id, raw_data, metadata, import_session_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const rawTx of rawData) {
          const providerId = options?.providerId || undefined;
          const rawDataJson = JSON.stringify(rawTx.data);
          const metadataJson = options?.metadata ? JSON.stringify(options.metadata) : undefined;
          const importSessionId = options?.importSessionId || undefined;

          stmt.run([sourceId, sourceType, providerId, rawDataJson, metadataJson, importSessionId], function (err) {
            completed++;

            if (err && !err.message.includes('UNIQUE constraint failed')) {
              if (!hasError) {
                hasError = true;
                stmt.finalize();
                reject(err);
              }
              return;
            }

            if (this.changes > 0) saved++;

            if (completed === total && !hasError) {
              stmt.finalize();
              db.run('COMMIT', (commitErr) => {
                if (commitErr) {
                  logger.error(`Failed to commit transaction: ${String(commitErr)}`);
                  reject(commitErr);
                } else {
                  logger.info(`Successfully saved ${saved}/${rawData.length} raw data items for ${sourceId}`);
                  resolve(saved);
                }
              });
            }
          });
        }
      });
    });
  }

  async updateProcessingStatus(
    rawTransactionId: number,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        UPDATE external_transaction_data
        SET processing_status = ?, processing_error = ?, processed_at = ?
        WHERE id = ? AND (provider_id = ? OR (provider_id IS NULL AND ? IS NULL))
      `);

      const processedAt = status === 'processed' ? Math.floor(Date.now() / 1000) : undefined;
      const logger = this.logger;

      stmt.run(
        [status, error || undefined, processedAt, rawTransactionId, providerId || undefined, providerId || undefined],
        function (err) {
          if (err) {
            logger.error(`Failed to update processing status for ${rawTransactionId}: ${String(err)}`);
            reject(err);
          } else {
            resolve();
          }
        }
      );

      stmt.finalize();
    });
  }
}

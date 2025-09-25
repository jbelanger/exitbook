import type { Database } from '@crypto/data/src/storage/database.ts';
import type { StoredRawData } from '@crypto/data/src/types/data-types.ts';
import { getLogger } from '@crypto/shared-logger';

import type {
  IRawDataRepository,
  LoadRawDataFilters,
  SaveRawDataOptions,
} from '../../app/ports/raw-data-repository.ts';

/**
 * Database implementation of IExternalDataStore.
 * Uses the enhanced external_transaction_data table for storing raw data.
 */
export class RawDataRepository implements IRawDataRepository {
  private logger = getLogger('RawDataRepository');

  constructor(private database: Database) {}

  async load(filters?: LoadRawDataFilters): Promise<StoredRawData[]> {
    this.logger.info(`Loading raw data with filters: ${JSON.stringify(filters)}`);

    try {
      const rawData = await this.database.getRawTransactions(filters);

      this.logger.info(`Loaded ${rawData.length} raw data items`);
      return rawData.map((item) => ({
        createdAt: item.createdAt,
        id: item.id,
        importSessionId: item.importSessionId,
        metadata: item.metadata,
        processedAt: item.processedAt,
        processingError: item.processingError,
        processingStatus: item.processingStatus,
        providerId: item.providerId,
        rawData: item.rawData,
        sourceId: item.sourceId,
        sourceType: item.sourceType,
      }));
    } catch (error) {
      this.logger.error(`Failed to load raw data: ${String(error)}`);
      throw error;
    }
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

    try {
      const saved = await this.database.saveRawTransactions(sourceId, sourceType, rawData, {
        importSessionId: options?.importSessionId ?? undefined,
        metadata: options?.metadata,
        providerId: options?.providerId ?? undefined,
      });

      this.logger.info(`Successfully saved ${saved}/${rawData.length} raw data items for ${sourceId}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to save raw data for ${sourceId}: ${String(error)}`);
      throw error;
    }
  }

  async updateProcessingStatus(
    rawTransactionId: number,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void> {
    try {
      await this.database.updateRawTransactionProcessingStatus(rawTransactionId, status, error, providerId);
    } catch (error) {
      this.logger.error(`Failed to update processing status for ${rawTransactionId}: ${String(error)}`);
      throw error;
    }
  }
}

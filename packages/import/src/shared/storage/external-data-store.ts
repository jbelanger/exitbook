import type { Database } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';

import type { StoredRawData } from '../processors/interfaces.ts';
import type { IExternalDataStore, LoadRawDataFilters, SaveRawDataOptions } from './interfaces.ts';

/**
 * Database implementation of IExternalDataStore.
 * Uses the enhanced external_transaction_data table for storing raw data.
 */
export class ExternalDataStore implements IExternalDataStore {
  private logger = getLogger('ExternalDataStore');

  constructor(private database: Database) {}

  async load(filters?: LoadRawDataFilters): Promise<StoredRawData[]> {
    this.logger.info(`Loading raw data with filters: ${JSON.stringify(filters)}`);

    try {
      const rawData = await this.database.getRawTransactions(filters);

      this.logger.info(`Loaded ${rawData.length} raw data items`);
      return rawData.map(item => ({
        adapterId: item.adapterId,
        adapterType: item.adapterType,
        createdAt: item.createdAt,
        id: item.id,
        importSessionId: item.importSessionId,
        metadata: item.metadata,
        processedAt: item.processedAt,
        processingError: item.processingError,
        processingStatus: item.processingStatus,
        providerId: item.providerId,
        rawData: item.rawData,
        sourceTransactionId: item.sourceTransactionId,
      }));
    } catch (error) {
      this.logger.error(`Failed to load raw data: ${error}`);
      throw error;
    }
  }

  async markAsProcessed(adapterId: string, sourceTransactionIds: string[], providerId?: string): Promise<void> {
    this.logger.info(`Marking ${sourceTransactionIds.length} items as processed for ${adapterId}`);

    try {
      const promises = sourceTransactionIds.map(id =>
        this.updateProcessingStatus(adapterId, id, 'processed', undefined, providerId)
      );

      await Promise.all(promises);

      this.logger.info(`Successfully marked ${sourceTransactionIds.length} items as processed for ${adapterId}`);
    } catch (error) {
      this.logger.error(`Failed to mark items as processed for ${adapterId}: ${error}`);
      throw error;
    }
  }

  async save(
    adapterId: string,
    adapterType: string,
    rawData: Array<{ data: unknown; id: string; }>,
    options?: SaveRawDataOptions
  ): Promise<number> {
    this.logger.info(`Saving ${rawData.length} raw data items for ${adapterId}`);

    try {
      const saved = await this.database.saveRawTransactions(adapterId, adapterType, rawData, {
        importSessionId: options?.importSessionId ?? undefined,
        metadata: options?.metadata,
        providerId: options?.providerId ?? undefined,
      });

      this.logger.info(`Successfully saved ${saved}/${rawData.length} raw data items for ${adapterId}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to save raw data for ${adapterId}: ${error}`);
      throw error;
    }
  }

  async saveSingle(
    adapterId: string,
    adapterType: string,
    sourceTransactionId: string,
    rawData: unknown,
    options?: SaveRawDataOptions
  ): Promise<void> {
    this.logger.debug(`Saving single raw data item ${sourceTransactionId} for ${adapterId}`);

    try {
      await this.database.saveRawTransaction(adapterId, adapterType, sourceTransactionId, rawData, {
        importSessionId: options?.importSessionId ?? undefined,
        metadata: options?.metadata,
        providerId: options?.providerId ?? undefined,
      });

      this.logger.debug(`Successfully saved raw data item ${sourceTransactionId} for ${adapterId}`);
    } catch (error) {
      this.logger.error(`Failed to save raw data item ${sourceTransactionId} for ${adapterId}: ${error}`);
      throw error;
    }
  }

  async updateProcessingStatus(
    adapterId: string,
    sourceTransactionId: string,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void> {
    this.logger.debug(`Updating processing status for ${adapterId}:${sourceTransactionId} to ${status}`);

    try {
      await this.database.updateRawTransactionProcessingStatus(
        adapterId,
        sourceTransactionId,
        status,
        error,
        providerId
      );

      this.logger.debug(`Successfully updated processing status for ${adapterId}:${sourceTransactionId}`);
    } catch (error) {
      this.logger.error(`Failed to update processing status for ${adapterId}:${sourceTransactionId}: ${error}`);
      throw error;
    }
  }
}

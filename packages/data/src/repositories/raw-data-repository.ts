import { getLogger } from '@crypto/shared-logger';
import type { Database } from '../storage/database.ts';
import type { StoredRawData } from '../types/data-types.ts';

export interface SaveRawDataOptions {
  importSessionId?: number | undefined;
  metadata?: unknown;
  providerId?: string | undefined;
}

export interface LoadRawDataFilters {
  importSessionId?: number | undefined;
  processingStatus?: 'pending' | 'processed' | 'failed' | undefined;
  providerId?: string | undefined;
  since?: number | undefined;
  sourceId?: string | undefined;
}

/**
 * Interface for storing and retrieving external data.
 * Abstracts the database operations for external transaction storage.
 */
export interface IRawDataRepository {
  /**
   * Load external data from storage with optional filtering.
   */
  load(filters?: LoadRawDataFilters): Promise<StoredRawData[]>;

  /**
   * Mark multiple items as processed.
   */
  markAsProcessed(sourceId: string, sourceTransactionIds: string[], providerId?: string): Promise<void>;

  /**
   * Save external data items to storage.
   */
  save(
    sourceId: string,
    sourceType: string,
    rawData: Array<{ data: unknown; id: string }>,
    options?: SaveRawDataOptions
  ): Promise<number>;

  /**
   * Save a single external data item to storage.
   */
  saveSingle(
    sourceId: string,
    sourceType: string,
    sourceTransactionId: string,
    rawData: unknown,
    options?: SaveRawDataOptions
  ): Promise<void>;

  /**
   * Update the processing status of external data items.
   */
  updateProcessingStatus(
    sourceId: string,
    sourceTransactionId: string,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void>;
}

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
      return rawData.map(item => ({
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
        sourceTransactionId: item.sourceTransactionId,
        sourceType: item.sourceType,
      }));
    } catch (error) {
      this.logger.error(`Failed to load raw data: ${error}`);
      throw error;
    }
  }

  async markAsProcessed(sourceId: string, sourceTransactionIds: string[], providerId?: string): Promise<void> {
    this.logger.info(`Marking ${sourceTransactionIds.length} items as processed for ${sourceId}`);

    try {
      const promises = sourceTransactionIds.map(id =>
        this.updateProcessingStatus(sourceId, id, 'processed', undefined, providerId)
      );

      await Promise.all(promises);

      this.logger.info(`Successfully marked ${sourceTransactionIds.length} items as processed for ${sourceId}`);
    } catch (error) {
      this.logger.error(`Failed to mark items as processed for ${sourceId}: ${error}`);
      throw error;
    }
  }

  async save(
    sourceId: string,
    sourceType: string,
    rawData: Array<{ data: unknown; id: string }>,
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
      this.logger.error(`Failed to save raw data for ${sourceId}: ${error}`);
      throw error;
    }
  }

  async saveSingle(
    sourceId: string,
    sourceType: string,
    sourceTransactionId: string,
    rawData: unknown,
    options?: SaveRawDataOptions
  ): Promise<void> {
    this.logger.debug(`Saving single raw data item ${sourceTransactionId} for ${sourceId}`);

    try {
      await this.database.saveRawTransaction(sourceId, sourceType, sourceTransactionId, rawData, {
        importSessionId: options?.importSessionId ?? undefined,
        metadata: options?.metadata,
        providerId: options?.providerId ?? undefined,
      });

      this.logger.debug(`Successfully saved raw data item ${sourceTransactionId} for ${sourceId}`);
    } catch (error) {
      this.logger.error(`Failed to save raw data item ${sourceTransactionId} for ${sourceId}: ${error}`);
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
    try {
      await this.database.updateRawTransactionProcessingStatus(
        adapterId,
        sourceTransactionId,
        status,
        error,
        providerId
      );

    } catch (error) {
      this.logger.error(`Failed to update processing status for ${adapterId}:${sourceTransactionId}: ${error}`);
      throw error;
    }
  }
}

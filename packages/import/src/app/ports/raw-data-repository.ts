import type { RawData } from '@exitbook/data';

import type { RawTransactionMetadata } from './importers.js';

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
  load(filters?: LoadRawDataFilters): Promise<RawData[]>;

  /**
   * Mark multiple items as processed.
   */
  markAsProcessed(sourceId: string, sourceTransactionIds: number[], providerId?: string): Promise<void> | undefined;

  /**
   * Save external data items to storage.
   */
  save(
    rawData: unknown,
    importSessionId: number,
    providerId: string,
    metadata?: RawTransactionMetadata
  ): Promise<number>;

  /**
   * Save multiple external data items to storage in a single transaction.
   */
  saveBatch(
    items: { metadata?: RawTransactionMetadata; providerId: string; rawData: unknown }[],
    importSessionId: number
  ): Promise<number>;
}

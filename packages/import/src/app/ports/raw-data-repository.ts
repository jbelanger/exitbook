import type { RawData } from '@exitbook/data';
import type { Result } from 'neverthrow';

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
 * All operations return Result types for proper error handling.
 */
export interface IRawDataRepository {
  /**
   * Load external data from storage with optional filtering.
   */
  load(filters?: LoadRawDataFilters): Promise<Result<RawData[], Error>>;

  /**
   * Mark multiple items as processed.
   */
  markAsProcessed(sourceId: string, sourceTransactionIds: number[], providerId?: string): Promise<Result<void, Error>>;

  /**
   * Save external data items to storage.
   */
  save(
    rawData: unknown,
    importSessionId: number,
    providerId: string,
    metadata?: RawTransactionMetadata
  ): Promise<Result<number, Error>>;

  /**
   * Save multiple external data items to storage in a single transaction.
   */
  saveBatch(
    items: { metadata?: RawTransactionMetadata; providerId: string; rawData: unknown }[],
    importSessionId: number
  ): Promise<Result<number, Error>>;
}

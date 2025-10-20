import type { RawTransactionWithMetadata } from '@exitbook/core';
import type { RawData } from '@exitbook/data';
import type { Result } from 'neverthrow';

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
  markAsProcessed(sourceId: string, sourceTransactionIds: number[]): Promise<Result<void, Error>>;

  /**
   * Save external data items to storage.
   */
  save(importSessionId: number, item: RawTransactionWithMetadata): Promise<Result<number, Error>>;

  /**
   * Save multiple external data items to storage in a single transaction.
   */
  saveBatch(importSessionId: number, items: RawTransactionWithMetadata[]): Promise<Result<number, Error>>;

  /**
   * Get the latest cursor for resuming imports.
   * Returns a cursor object with per-operation timestamps for exchanges.
   */
  getLatestCursor(importSessionId: number): Promise<Result<Record<string, number> | null, Error>>;

  /**
   * Get records with valid normalized data (where normalized_data is not null).
   * Used during processing step.
   */
  getValidRecords(importSessionId: number): Promise<Result<RawData[], Error>>;
}

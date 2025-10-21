import type { ExternalTransactionData, ExternalTransaction } from '@exitbook/core';
import type { Result } from 'neverthrow';

export interface LoadRawDataFilters {
  dataSourceId?: number | undefined;
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
  load(filters?: LoadRawDataFilters): Promise<Result<ExternalTransactionData[], Error>>;

  /**
   * Mark multiple items as processed.
   */
  markAsProcessed(sourceId: string, sourceTransactionIds: number[]): Promise<Result<void, Error>>;

  /**
   * Save external data items to storage.
   */
  save(dataSourceId: number, item: ExternalTransaction): Promise<Result<number, Error>>;

  /**
   * Save multiple external data items to storage in a single transaction.
   */
  saveBatch(dataSourceId: number, items: ExternalTransaction[]): Promise<Result<number, Error>>;

  /**
   * Get the latest cursor for resuming imports.
   * Returns a cursor object with per-operation timestamps for exchanges.
   */
  getLatestCursor(dataSourceId: number): Promise<Result<Record<string, number> | null, Error>>;

  /**
   * Get records with valid normalized data (where normalized_data is not null).
   * Used during processing step.
   */
  getValidRecords(dataSourceId: number): Promise<Result<ExternalTransactionData[], Error>>;
}

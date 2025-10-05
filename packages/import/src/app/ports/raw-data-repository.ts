import type { RawData, RawTransactionWithMetadata } from '@exitbook/data';
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
   * Get records that need validation (where parsed_data is null).
   * Used for revalidation on each import run.
   */
  getRecordsNeedingValidation(importSessionId: number): Promise<Result<RawData[], Error>>;

  /**
   * Get records with valid parsed data (where parsed_data is not null).
   * Used during processing step.
   */
  getValidRecords(importSessionId: number): Promise<Result<RawData[], Error>>;

  /**
   * Update parsed data and clear validation error after successful revalidation.
   */
  updateParsedData(id: number, parsedData: unknown): Promise<Result<void, Error>>;
}

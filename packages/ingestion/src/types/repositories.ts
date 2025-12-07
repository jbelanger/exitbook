import type {
  ImportSession,
  ImportSessionStatus,
  ExternalTransaction,
  ExternalTransactionData,
  ProcessingStatus,
} from '@exitbook/core';
import type { ImportSessionUpdate, ImportSessionQuery } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Filter options for loading raw data from repository
 * Ingestion-specific concern
 * Raw data is scoped by account - each account owns its transaction data
 */
export interface LoadRawDataFilters {
  accountId?: number | undefined;
  processingStatus?: ProcessingStatus | undefined;
  providerName?: string | undefined;
  since?: number | undefined;
}

/**
 * Interface for raw data repository operations.
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
  markAsProcessed(rawTransactionIds: number[]): Promise<Result<void, Error>>;

  /**
   * Save external data item to storage.
   */
  save(accountId: number, item: ExternalTransaction): Promise<Result<number, Error>>;

  /**
   * Save multiple external data items to storage in a single transaction.
   * Returns inserted and skipped counts (skipped = duplicates per unique constraint).
   */
  saveBatch(
    accountId: number,
    items: ExternalTransaction[]
  ): Promise<Result<{ inserted: number; skipped: number }, Error>>;

  /**
   * Reset processing status to 'pending' for all raw data for an account.
   * Used when clearing processed data but keeping raw data for reprocessing.
   */
  resetProcessingStatusByAccount(accountId: number): Promise<Result<number, Error>>;

  /**
   * Reset processing status to 'pending' for all raw data.
   * Used when clearing all processed data but keeping raw data for reprocessing.
   */
  resetProcessingStatusAll(): Promise<Result<number, Error>>;

  /**
   * Count all raw data.
   */
  countAll(): Promise<Result<number, Error>>;

  /**
   * Count raw data by account IDs.
   */
  countByAccount(accountIds: number[]): Promise<Result<number, Error>>;

  /**
   * Delete all raw data for an account.
   */
  deleteByAccount(accountId: number): Promise<Result<number, Error>>;

  /**
   * Delete all raw data.
   */
  deleteAll(): Promise<Result<number, Error>>;
}

/**
 * Interface for import session repository operations.
 */
export interface IImportSessionRepository {
  /**
   * Create a new import session for an account.
   */
  create(accountId: number): Promise<Result<number, Error>>;

  /**
   * Finalize an import session with results and status.
   */
  finalize(
    sessionId: number,
    status: Exclude<ImportSessionStatus, 'started'>,
    startTime: number,
    transactionsImported: number,
    transactionsSkipped: number,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<Result<void, Error>>;

  /**
   * Find all import sessions with optional filtering.
   */
  findAll(filters?: ImportSessionQuery): Promise<Result<ImportSession[], Error>>;

  /**
   * Find import session by ID.
   */
  findById(sessionId: number): Promise<Result<ImportSession | undefined, Error>>;

  /**
   * Find all import sessions for an account.
   */
  findByAccount(accountId: number, limit?: number): Promise<Result<ImportSession[], Error>>;

  /**
   * Find all import sessions for multiple accounts in one query (avoids N+1).
   */
  findByAccounts(accountIds: number[]): Promise<Result<ImportSession[], Error>>;

  /**
   * Get all import_session_ids (session IDs) for multiple accounts in one query (avoids N+1).
   * Returns an array of session IDs across all specified accounts.
   */
  getImportSessionIdsByAccounts(accountIds: number[]): Promise<Result<number[], Error>>;

  /**
   * Get session counts for multiple accounts in one query (avoids N+1).
   * Returns a Map of accountId -> session count.
   */
  getSessionCountsByAccount(accountIds: number[]): Promise<Result<Map<number, number>, Error>>;

  /**
   * Find latest incomplete import session for an account to support resume.
   * Status 'started' or 'failed' indicates incomplete import.
   */
  findLatestIncomplete(accountId: number): Promise<Result<ImportSession | undefined, Error>>;

  /**
   * Update an existing import session.
   */
  update(sessionId: number, updates: ImportSessionUpdate): Promise<Result<void, Error>>;

  /**
   * Count all import sessions.
   */
  countAll(): Promise<Result<number, Error>>;

  /**
   * Count import sessions by account IDs.
   */
  countByAccount(accountIds: number[]): Promise<Result<number, Error>>;

  /**
   * Delete all import sessions for an account.
   */
  deleteByAccount(accountId: number): Promise<Result<void, Error>>;

  /**
   * Delete all import sessions.
   */
  deleteAll(): Promise<Result<void, Error>>;
}

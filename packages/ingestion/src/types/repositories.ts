import type {
  DataSource,
  DataSourceStatus,
  ExternalTransaction,
  ExternalTransactionData,
  ProcessingStatus,
} from '@exitbook/core';
import type { DataSourceUpdate, ImportSessionQuery } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Filter options for loading raw data from repository
 * Ingestion-specific concern
 * Per ADR-007: Use accountId to filter by source (via import_sessions.account_id)
 */
export interface LoadRawDataFilters {
  accountId?: number | undefined;
  dataSourceId?: number | undefined;
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
   * Get records with valid normalized data (where normalized_data is not null).
   * Used during processing step.
   */
  getValidRecords(dataSourceId: number): Promise<Result<ExternalTransactionData[], Error>>;

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
 * Per ADR-007: import_sessions represents discrete import events, linked to accounts via account_id
 */
export interface IDataSourceRepository {
  /**
   * Create a new import session for an account.
   * Per ADR-007: Each import execution creates a new session record
   */
  create(accountId: number): Promise<Result<number, Error>>;

  /**
   * Finalize an import session with results and status.
   */
  finalize(
    sessionId: number,
    status: Exclude<DataSourceStatus, 'started'>,
    startTime: number,
    errorMessage?: string,
    errorDetails?: unknown,
    importResultMetadata?: Record<string, unknown>
  ): Promise<Result<void, Error>>;

  /**
   * Find all import sessions with optional filtering.
   */
  findAll(filters?: ImportSessionQuery): Promise<Result<DataSource[], Error>>;

  /**
   * Find import session by ID.
   */
  findById(sessionId: number): Promise<Result<DataSource | undefined, Error>>;

  /**
   * Find all import sessions for an account.
   */
  findByAccount(accountId: number, limit?: number): Promise<Result<DataSource[], Error>>;

  /**
   * Get all data_source_ids (session IDs) for multiple accounts in one query (avoids N+1).
   * Returns an array of session IDs across all specified accounts.
   */
  getDataSourceIdsByAccounts(accountIds: number[]): Promise<Result<number[], Error>>;

  /**
   * Find latest incomplete import session for an account to support resume.
   * Status 'started' or 'failed' indicates incomplete import.
   * Per ADR-007: Cursors are stored in accounts table, not sessions
   */
  findLatestIncomplete(accountId: number): Promise<Result<DataSource | undefined, Error>>;

  /**
   * Update an existing import session.
   */
  update(sessionId: number, updates: DataSourceUpdate): Promise<Result<void, Error>>;

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

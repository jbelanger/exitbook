import type {
  CursorState,
  DataImportParams,
  DataSource,
  DataSourceStatus,
  VerificationMetadata,
  ExternalTransaction,
  ExternalTransactionData,
  ProcessingStatus,
  SourceType,
} from '@exitbook/core';
import type { DataSourceUpdate, ImportSessionQuery } from '@exitbook/data';
import type { Result } from 'neverthrow';

import type { ImportParams } from './importers.js';

/**
 * Filter options for loading raw data from repository
 * Ingestion-specific concern
 */
export interface LoadRawDataFilters {
  dataSourceId?: number | undefined;
  processingStatus?: ProcessingStatus | undefined;
  providerName?: string | undefined;
  since?: number | undefined;
  sourceId?: string | undefined;
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
}

/**
 * Interface for data source repository operations.
 */
export interface IDataSourceRepository {
  /**
   * Create a new data source.
   */
  create(sourceId: string, sourceType: SourceType, importParams?: DataImportParams): Promise<Result<number, Error>>;

  /**
   * Finalize a data source with results and status.
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
   * Find all data sources with optional filtering.
   */
  findAll(filters?: ImportSessionQuery): Promise<Result<DataSource[], Error>>;

  /**
   * Find data source by ID.
   */
  findById(sessionId: number): Promise<Result<DataSource | undefined, Error>>;

  /**
   * Find data sources by source ID.
   */
  findBySource(sourceId: string, limit?: number): Promise<Result<DataSource[], Error>>;

  /**
   * Update an existing data source.
   */
  update(sessionId: number, updates: DataSourceUpdate): Promise<Result<void, Error>>;

  /**
   * Find a completed data source with matching parameters.
   */
  findCompletedWithMatchingParams(
    sourceId: string,
    sourceType: SourceType,
    params: ImportParams
  ): Promise<Result<DataSource | undefined, Error>>;

  /**
   * Update verification metadata for a session.
   */
  updateVerificationMetadata(
    sessionId: number,
    verificationMetadata: VerificationMetadata
  ): Promise<Result<void, Error>>;

  /**
   * Update cursor for a specific operation type.
   * Merges with existing cursors to support multi-operation imports.
   */
  updateCursor(dataSourceId: number, operationType: string, cursor: CursorState): Promise<Result<void, Error>>;

  /**
   * Delete all data sources for a given source ID.
   */
  deleteBySource(sourceId: string): Promise<Result<void, Error>>;

  /**
   * Delete all data sources.
   */
  deleteAll(): Promise<Result<void, Error>>;
}

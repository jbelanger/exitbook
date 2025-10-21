import type { DataImportParams, DataSource, VerificationMetadata } from '@exitbook/core';
import type { ImportSessionQuery, DataSourceUpdate } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Port interface for data source  repository operations.
 * Abstracts persistence layer from the application domain.
 */
export interface IDataSourceRepository {
  /**
   * Create a new data source .
   */
  create(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    importParams?: DataImportParams
  ): Promise<Result<number, Error>>;

  /**
   * Finalize an data source  with results and status.
   */
  finalize(
    sessionId: number,
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    errorMessage?: string,
    errorDetails?: unknown,
    importResultMetadata?: Record<string, unknown>
  ): Promise<Result<void, Error>>;

  /**
   * Find active import sessions.
   */
  findActive(): Promise<Result<DataSource[], Error>>;

  /**
   * Find all import sessions with optional filtering.
   */
  findAll(filters?: ImportSessionQuery): Promise<Result<DataSource[], Error>>;

  /**
   * Find data source  by ID.
   */
  findById(sessionId: number): Promise<Result<DataSource | undefined, Error>>;

  /**
   * Find import sessions by source ID.
   */
  findBySource(sourceId: string, limit?: number): Promise<Result<DataSource[], Error>>;

  /**
   * Find recent import sessions.
   */
  findRecent(limit?: number): Promise<Result<DataSource[], Error>>;

  /**
   * Update an existing data source .
   */
  update(sessionId: number, updates: DataSourceUpdate): Promise<Result<void, Error>>;

  /**
   * Find a completed data source  with matching parameters.
   */
  findCompletedWithMatchingParams(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: {
      address?: string | undefined;
      csvDirectories?: string[] | undefined;
      providerId?: string | undefined;
      since?: number | undefined;
    }
  ): Promise<Result<DataSource | undefined, Error>>;

  /**
   * Update verification metadata for a session.
   */
  updateVerificationMetadata(
    sessionId: number,
    verificationMetadata: VerificationMetadata
  ): Promise<Result<void, Error>>;

  /**
   * Delete all data sources for a given source ID.
   */
  deleteBySource(sourceId: string): Promise<Result<void, Error>>;

  /**
   * Delete all data sources.
   */
  deleteAll(): Promise<Result<void, Error>>;
}

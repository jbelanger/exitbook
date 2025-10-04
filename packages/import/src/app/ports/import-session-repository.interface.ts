import type { ImportSession, ImportSessionQuery, ImportSessionUpdate } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Port interface for import session repository operations.
 * Abstracts persistence layer from the application domain.
 */
export interface IImportSessionRepository {
  /**
   * Create a new import session.
   */
  create(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    providerId?: string,
    sessionMetadata?: unknown
  ): Promise<Result<number, Error>>;

  /**
   * Finalize an import session with results and status.
   */
  finalize(
    sessionId: number,
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    transactionsImported?: number,
    transactionsFailed?: number,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<Result<void, Error>>;

  /**
   * Find active import sessions.
   */
  findActive(): Promise<Result<ImportSession[], Error>>;

  /**
   * Find all import sessions with optional filtering.
   */
  findAll(filters?: ImportSessionQuery): Promise<Result<ImportSession[], Error>>;

  /**
   * Find import session by ID.
   */
  findById(sessionId: number): Promise<Result<ImportSession | undefined, Error>>;

  /**
   * Find import sessions by source ID.
   */
  findBySource(sourceId: string, limit?: number): Promise<Result<ImportSession[], Error>>;

  /**
   * Find recent import sessions.
   */
  findRecent(limit?: number): Promise<Result<ImportSession[], Error>>;

  /**
   * Update an existing import session.
   */
  update(sessionId: number, updates: ImportSessionUpdate): Promise<Result<void, Error>>;

  /**
   * Find a completed import session with matching parameters.
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
  ): Promise<Result<ImportSession | undefined, Error>>;
}

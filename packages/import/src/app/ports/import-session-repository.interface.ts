import type { ImportSession, ImportSessionQuery, ImportSessionUpdate } from '@exitbook/data';

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
  ): Promise<number>;

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
  ): Promise<void>;

  /**
   * Find active import sessions.
   */
  findActive(): Promise<ImportSession[]>;

  /**
   * Find all import sessions with optional filtering.
   */
  findAll(filters?: ImportSessionQuery): Promise<ImportSession[]>;

  /**
   * Find import session by ID.
   */
  findById(sessionId: number): Promise<ImportSession | undefined>;

  /**
   * Find import sessions by source ID.
   */
  findBySource(sourceId: string, limit?: number): Promise<ImportSession[]>;

  /**
   * Find recent import sessions.
   */
  findRecent(limit?: number): Promise<ImportSession[]>;

  /**
   * Update an existing import session.
   */
  update(sessionId: number, updates: ImportSessionUpdate): Promise<void>;
}

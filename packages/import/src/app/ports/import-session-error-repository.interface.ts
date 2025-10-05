import type { ImportSessionError } from '@exitbook/data';
import type { Result } from 'neverthrow';

export interface CreateImportSessionErrorParams {
  errorDetails?: unknown;
  errorMessage: string;
  errorType: 'validation' | 'fetch' | 'processing';
  failedItemData?: unknown;
  importSessionId: number;
}

/**
 * Port interface for import session error repository operations.
 * Abstracts persistence layer from the application domain.
 */
export interface IImportSessionErrorRepository {
  /**
   * Create a new import session error record.
   */
  create(params: CreateImportSessionErrorParams): Promise<Result<number, Error>>;

  /**
   * Find all errors for a specific import session.
   */
  findBySessionId(sessionId: number): Promise<Result<ImportSessionError[], Error>>;

  /**
   * Find errors by type for a specific import session.
   */
  findBySessionIdAndType(
    sessionId: number,
    errorType: 'validation' | 'fetch' | 'processing'
  ): Promise<Result<ImportSessionError[], Error>>;

  /**
   * Get the count of errors for a specific import session.
   */
  getErrorCount(sessionId: number): Promise<Result<number, Error>>;
}

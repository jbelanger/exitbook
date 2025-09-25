import type { UniversalTransaction } from '@crypto/core';
import type {
  ImportSession,
  ImportSessionQuery,
  UpdateImportSessionRequest,
  ImportSessionWithRawData,
} from '@crypto/data/src/types/data-types.ts';

import type { LoadRawDataFilters } from './raw-data-repository.ts';

/**
 * Port interface for database operations required by the application layer.
 * Abstracts database implementation details from the domain logic.
 */
export interface IDatabase {
  /**
   * Create a new import session.
   */
  createImportSession(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    providerId?: string,
    sessionMetadata?: unknown
  ): Promise<number>;

  /**
   * Finalize an import session.
   */
  finalizeImportSession(
    sessionId: number,
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    transactionsImported: number,
    transactionsFailed: number,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<void>;

  /**
   * Get a specific import session by ID.
   */
  getImportSession(sessionId: number): Promise<ImportSession | undefined>;

  /**
   * Get import sessions with optional filters.
   */
  getImportSessions(filters?: ImportSessionQuery): Promise<ImportSession[]>;

  /**
   * Get import sessions with their associated raw data.
   */
  getImportSessionsWithRawData(filters: { sourceId: string }): Promise<ImportSessionWithRawData[]>;

  /**
   * Get raw transactions with optional filters.
   */
  getRawTransactions(filters?: LoadRawDataFilters): Promise<unknown[]>;

  /**
   * Save raw transactions to database.
   */
  saveRawTransactions(
    sourceId: string,
    sourceType: string,
    rawData: { data: unknown }[],
    options?: {
      importSessionId?: number;
      metadata?: unknown;
      providerId?: string;
    }
  ): Promise<number>;

  /**
   * Save a transaction to the database.
   */
  saveTransaction(transaction: UniversalTransaction): Promise<number>;

  /**
   * Update an import session.
   */
  updateImportSession(sessionId: number, updates: UpdateImportSessionRequest): Promise<void>;

  /**
   * Update processing status of raw transaction.
   */
  updateRawTransactionProcessingStatus(
    rawTransactionId: number,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void>;
}

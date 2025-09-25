import type { Database } from '@crypto/data';

import type { IDatabase } from '../../app/ports/database.ts';

/**
 * Adapter that implements the IDatabase port using the concrete Database implementation.
 * This bridges the application layer (ports) with the infrastructure layer.
 */
export class DatabaseAdapter implements IDatabase {
  constructor(private database: Database) {}

  async saveTransaction(transaction: unknown): Promise<number> {
    return this.database.saveTransaction(transaction);
  }

  async getImportSessionsWithRawData(filters: { sourceId: string }) {
    return this.database.getImportSessionsWithRawData(filters);
  }

  async createImportSession(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    providerId?: string,
    sessionMetadata?: unknown
  ): Promise<number> {
    return this.database.createImportSession(sourceId, sourceType, providerId, sessionMetadata);
  }

  async finalizeImportSession(
    sessionId: number,
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    transactionsImported: number,
    transactionsFailed: number,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<void> {
    return this.database.finalizeImportSession(
      sessionId,
      status,
      startTime,
      transactionsImported,
      transactionsFailed,
      errorMessage,
      errorDetails
    );
  }

  async getImportSessions(filters?: unknown) {
    return this.database.getImportSessions(filters);
  }

  async getImportSession(sessionId: number) {
    return this.database.getImportSession(sessionId);
  }

  async updateImportSession(sessionId: number, updates: unknown): Promise<void> {
    return this.database.updateImportSession(sessionId, updates);
  }

  async getRawTransactions(filters?: unknown) {
    return this.database.getRawTransactions(filters);
  }

  async saveRawTransactions(
    sourceId: string,
    sourceType: string,
    rawData: { data: unknown }[],
    options?: {
      importSessionId?: number;
      metadata?: unknown;
      providerId?: string;
    }
  ): Promise<number> {
    return this.database.saveRawTransactions(sourceId, sourceType, rawData, options);
  }

  async updateRawTransactionProcessingStatus(
    rawTransactionId: number,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void> {
    return this.database.updateRawTransactionProcessingStatus(rawTransactionId, status, error, providerId);
  }
}

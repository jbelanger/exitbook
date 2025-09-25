import type { Database } from '@crypto/data';

import type { IImportSessionRepository } from '../../app/ports/import-session-repository.ts';
import { ImportSessionRepository } from '../persistence/import-session-repository.ts';

/**
 * Adapter that implements the IImportSessionRepository port using the concrete ImportSessionRepository implementation.
 * This bridges the application layer (ports) with the infrastructure layer.
 */
export class ImportSessionRepositoryAdapter implements IImportSessionRepository {
  private repository: ImportSessionRepository;

  constructor(database: Database) {
    this.repository = new ImportSessionRepository(database);
  }

  async create(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    providerId?: string,
    sessionMetadata?: unknown
  ): Promise<number> {
    return this.repository.create(sourceId, sourceType, providerId, sessionMetadata);
  }

  async finalize(
    sessionId: number,
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    transactionsImported = 0,
    transactionsFailed = 0,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<void> {
    return this.repository.finalize(
      sessionId,
      status,
      startTime,
      transactionsImported,
      transactionsFailed,
      errorMessage,
      errorDetails
    );
  }

  async findActive() {
    return this.repository.findActive();
  }

  async findAll(filters?: unknown) {
    return this.repository.findAll(filters);
  }

  async findById(sessionId: number) {
    return this.repository.findById(sessionId);
  }

  async findBySource(sourceId: string, limit?: number) {
    return this.repository.findBySource(sourceId, limit);
  }

  async findRecent(limit = 10) {
    return this.repository.findRecent(limit);
  }

  async update(sessionId: number, updates: unknown): Promise<void> {
    return this.repository.update(sessionId, updates);
  }
}

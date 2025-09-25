import type { Database } from '@crypto/data/src/storage/database.ts';
import type {
  ImportSession,
  ImportSessionQuery,
  UpdateImportSessionRequest,
} from '@crypto/data/src/types/data-types.ts';

export class ImportSessionRepository {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async create(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    providerId?: string,
    sessionMetadata?: unknown
  ): Promise<number> {
    return this.database.createImportSession(sourceId, sourceType, providerId, sessionMetadata);
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

  async findActive(): Promise<ImportSession[]> {
    return this.database.getImportSessions({ status: 'started' });
  }

  async findAll(filters?: ImportSessionQuery): Promise<ImportSession[]> {
    return this.database.getImportSessions(filters);
  }

  async findById(sessionId: number): Promise<ImportSession | undefined> {
    return this.database.getImportSession(sessionId);
  }

  async findBySource(sourceId: string, limit?: number): Promise<ImportSession[]> {
    return this.database.getImportSessions({ limit, sourceId });
  }

  async findRecent(limit = 10): Promise<ImportSession[]> {
    return this.database.getImportSessions({ limit });
  }

  async update(sessionId: number, updates: UpdateImportSessionRequest): Promise<void> {
    return this.database.updateImportSession(sessionId, updates);
  }
}

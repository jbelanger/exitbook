import type { Database } from '@crypto/data/src/storage/database.ts';
import type {
  ImportSession,
  ImportSessionQuery,
  ImportSessionWithRawData,
  UpdateImportSessionRequest,
} from '@crypto/data/src/types/data-types.ts';
import type { ImportSessionRow } from '@crypto/data/src/types/database-types.ts';
import type sqlite3Module from 'sqlite3';

import type { IImportSessionRepository } from '../../app/ports/import-session-repository.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

function importSessionRowToImportSession(row: ImportSessionRow): ImportSession {
  return {
    completedAt: row.completed_at || undefined,
    createdAt: row.created_at,
    durationMs: row.duration_ms || undefined,
    errorDetails: row.error_details ? JSON.parse(row.error_details) : undefined,
    errorMessage: row.error_message || undefined,
    id: row.id,
    providerId: row.provider_id || undefined,
    sessionMetadata: row.session_metadata ? JSON.parse(row.session_metadata) : undefined,
    sourceId: row.source_id,
    sourceType: row.source_type,
    startedAt: row.started_at,
    status: row.status,
    transactionsFailed: row.transactions_failed,
    transactionsImported: row.transactions_imported,
    updatedAt: row.updated_at,
  };
}

export class ImportSessionRepository implements IImportSessionRepository {
  constructor(private db: SQLiteDatabase) {}

  async create(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    providerId?: string,
    sessionMetadata?: unknown
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const db = this.db;

      db.serialize(() => {
        db.run('BEGIN IMMEDIATE');

        const stmt = db.prepare(`
          INSERT INTO import_sessions
          (source_id, source_type, provider_id, session_metadata)
          VALUES (?, ?, ?, ?)
        `);

        const metadataJson = sessionMetadata ? JSON.stringify(sessionMetadata) : undefined;

        stmt.run([sourceId, sourceType, providerId || undefined, metadataJson], function (err) {
          const sessionId = this.lastID;
          stmt.finalize();

          if (err) {
            db.run('ROLLBACK', () => {
              reject(err);
            });
          } else {
            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                reject(commitErr);
              } else {
                resolve(sessionId);
              }
            });
          }
        });
      });
    });
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
    const durationMs = Date.now() - startTime;

    return this.update(sessionId, {
      errorDetails,
      errorMessage,
      status,
      transactionsFailed,
      transactionsImported,
    }).then(() => {
      return new Promise<void>((resolve, reject) => {
        this.db.run('UPDATE import_sessions SET duration_ms = ? WHERE id = ?', [durationMs, sessionId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  async findActive(): Promise<ImportSession[]> {
    return this.findAll({ status: 'started' });
  }

  async findAll(filters?: ImportSessionQuery): Promise<ImportSession[]> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM import_sessions';
      const params: (string | number)[] = [];
      const conditions: string[] = [];

      if (filters?.sourceId) {
        conditions.push('source_id = ?');
        params.push(filters.sourceId);
      }

      if (filters?.sourceType) {
        conditions.push('source_type = ?');
        params.push(filters.sourceType);
      }

      if (filters?.status) {
        conditions.push('status = ?');
        params.push(filters.status);
      }

      if (filters?.since) {
        conditions.push('started_at >= ?');
        params.push(filters.since);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY started_at DESC';

      if (filters?.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      this.db.all(query, params, (err, rows: ImportSessionRow[]) => {
        if (err) {
          reject(err);
        } else {
          const sessions = rows.map(importSessionRowToImportSession);
          resolve(sessions);
        }
      });
    });
  }

  async findById(sessionId: number): Promise<ImportSession | undefined> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM import_sessions WHERE id = ?';

      this.db.get(query, [sessionId], (err, row: ImportSessionRow | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          return;
        } else {
          resolve(importSessionRowToImportSession(row));
        }
      });
    });
  }

  async findBySource(sourceId: string, limit?: number): Promise<ImportSession[]> {
    return this.findAll({ limit, sourceId });
  }

  async findRecent(limit = 10): Promise<ImportSession[]> {
    return this.findAll({ limit });
  }

  async update(sessionId: number, updates: UpdateImportSessionRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      const setParts: string[] = [];
      const params: (string | number | undefined)[] = [];

      if (updates.status !== undefined) {
        setParts.push('status = ?');
        params.push(updates.status);

        if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
          setParts.push('completed_at = ?');
          params.push(Math.floor(Date.now() / 1000));
        }
      }

      if (updates.errorMessage !== undefined) {
        setParts.push('error_message = ?');
        params.push(updates.errorMessage);
      }

      if (updates.errorDetails !== undefined) {
        setParts.push('error_details = ?');
        params.push(updates.errorDetails ? JSON.stringify(updates.errorDetails) : undefined);
      }

      if (updates.transactionsImported !== undefined) {
        setParts.push('transactions_imported = ?');
        params.push(updates.transactionsImported);
      }

      if (updates.transactionsFailed !== undefined) {
        setParts.push('transactions_failed = ?');
        params.push(updates.transactionsFailed);
      }

      if (updates.sessionMetadata !== undefined) {
        setParts.push('session_metadata = ?');
        params.push(updates.sessionMetadata ? JSON.stringify(updates.sessionMetadata) : undefined);
      }

      if (setParts.length === 0) {
        resolve();
        return;
      }

      setParts.push('updated_at = ?');
      params.push(Math.floor(Date.now() / 1000));
      params.push(sessionId);

      const query = `UPDATE import_sessions SET ${setParts.join(', ')} WHERE id = ?`;

      this.db.run(query, params, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async findWithRawData(filters: { sourceId: string }): Promise<ImportSessionWithRawData[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT
          s.*,
          r.id as raw_id,
          r.provider_id,
          r.raw_data,
          r.metadata as raw_metadata,
          r.processing_status,
          r.processing_error,
          r.processed_at,
          r.created_at as raw_created_at
        FROM import_sessions s
        LEFT JOIN external_transaction_data r ON s.id = r.import_session_id
        WHERE s.source_id = ?
        ORDER BY s.started_at DESC, r.created_at ASC
      `;

      this.db.all(query, [filters.sourceId], (err, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          // Group results by session
          const sessionsMap = new Map<string, ImportSessionWithRawData>();

          rows.forEach((row) => {
            const dbRow = row as Record<string, unknown>;

            // Extract session data
            const sessionRow: ImportSessionRow = {
              completed_at: dbRow.completed_at ? (dbRow.completed_at as number) : undefined,
              created_at: dbRow.created_at as number,
              duration_ms: dbRow.duration_ms ? (dbRow.duration_ms as number) : undefined,
              error_details: dbRow.error_details ? (dbRow.error_details as string) : undefined,
              error_message: dbRow.error_message ? (dbRow.error_message as string) : undefined,
              id: dbRow.id as number,
              provider_id: dbRow.provider_id ? (dbRow.provider_id as string) : undefined,
              session_metadata: dbRow.session_metadata ? (dbRow.session_metadata as string) : undefined,
              source_id: dbRow.source_id as string,
              source_type: dbRow.source_type as 'exchange' | 'blockchain',
              started_at: dbRow.started_at as number,
              status: dbRow.status as 'started' | 'completed' | 'failed' | 'cancelled',
              transactions_failed: dbRow.transactions_failed as number,
              transactions_imported: dbRow.transactions_imported as number,
              updated_at: dbRow.updated_at as number,
            };

            const session = importSessionRowToImportSession(sessionRow);
            const sessionId = String(session.id);

            if (!sessionsMap.has(sessionId)) {
              sessionsMap.set(sessionId, {
                rawDataItems: [],
                session,
              });
            }

            // Add raw data item if present
            if (dbRow.raw_id) {
              const rawDataItem = {
                createdAt: dbRow.raw_created_at as number,
                id: dbRow.raw_id as number,
                importSessionId: session.id,
                metadata: dbRow.raw_metadata
                  ? (JSON.parse(dbRow.raw_metadata as string) as Record<string, unknown>)
                  : undefined,
                processedAt: dbRow.processed_at ? (dbRow.processed_at as number) : undefined,
                processingError: dbRow.processing_error ? (dbRow.processing_error as string) : undefined,
                processingStatus: dbRow.processing_status as string,
                providerId: dbRow.provider_id ? (dbRow.provider_id as string) : undefined,
                rawData: JSON.parse(dbRow.raw_data as string) as Record<string, unknown>,
                sourceId: session.sourceId,
                sourceType: session.sourceType,
              };

              sessionsMap.get(sessionId)!.rawDataItems.push(rawDataItem);
            }
          });

          const results = Array.from(sessionsMap.values());
          resolve(results);
        }
      });
    });
  }
}

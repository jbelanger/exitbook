import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BalanceSnapshot, BalanceVerificationRecord } from '@crypto/balance';
import type { UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import type { Decimal } from 'decimal.js';
import sqlite3Module from 'sqlite3';

import type {
  CreateWalletAddressRequest,
  ImportSession,
  ImportSessionQuery,
  ImportSessionWithRawData,
  StoredTransaction,
  UpdateImportSessionRequest,
  UpdateWalletAddressRequest,
  WalletAddress,
  WalletAddressQuery,
} from '../types/data-types.ts';
import type {
  DatabaseStats,
  ImportSessionRow,
  SQLParam,
  StatRow,
  TransactionCountRow,
} from '../types/database-types.js';

const sqlite3 = sqlite3Module;

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

// Local utility functions to avoid cyclic dependency with shared-utils
function moneyToDbString(money: { amount: Decimal | number; currency: string }): string {
  if (typeof money.amount === 'number') {
    return String(money.amount);
  }
  return money.amount.toString();
}

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

export class Database {
  private db: SQLiteDatabase;
  private dbPath: string;
  private logger = getLogger('Database');

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), 'data', 'transactions.db');
    const finalPath = dbPath || defaultPath;
    this.dbPath = finalPath;

    // Ensure data directory exists
    const dataDir = path.dirname(finalPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new sqlite3.Database(finalPath, (err) => {
      if (err) {
        this.logger.error(`Failed to connect to database: ${err.message} (path: ${finalPath})`);
        throw err;
      }
      this.logger.info(`Connected to SQLite database: ${finalPath}`);
    });

    // Enable foreign keys and WAL mode for better performance
    this.db.serialize(() => {
      this.db.run('PRAGMA foreign_keys = ON');
      this.db.run('PRAGMA journal_mode = WAL');
      this.db.run('PRAGMA synchronous = NORMAL');
    });

    this.initializeTables();
  }

  async addWalletAddress(request: CreateWalletAddressRequest): Promise<WalletAddress> {
    return new Promise((resolve, reject) => {
      const now = Math.floor(Date.now() / 1000);
      const addressType = request.addressType || 'personal';

      const query = `
        INSERT INTO wallet_addresses (address, blockchain, label, address_type, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        query,
        [request.address, request.blockchain, request.label, addressType, request.notes, now, now],
        function (err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              reject(
                new Error(`Wallet address ${request.address} already exists for blockchain ${request.blockchain}`)
              );
            } else {
              reject(err);
            }
          } else {
            // Fetch the created record
            resolve({
              address: request.address,
              addressType: addressType,
              blockchain: request.blockchain,
              createdAt: now,
              id: this.lastID,
              isActive: true,
              label: request.label ?? '',
              notes: request.notes ?? '',
              updatedAt: now,
            });
          }
        }
      );
    });
  }

  async clearAndReinitialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.debug('Clearing and reinitializing database');

      // Close current connection
      this.db.close((err) => {
        if (err) {
          this.logger.error(`Error closing database for reinitialization: ${err.message}`);
          return reject(err);
        }

        // Recreate connection and reinitialize with clear flag
        this.db = new sqlite3.Database(this.dbPath, (dbErr) => {
          if (dbErr) {
            this.logger.error(`Failed to reconnect to database: ${dbErr.message}`);
            return reject(dbErr);
          }

          // Enable foreign keys and WAL mode
          this.db.serialize(() => {
            this.db.run('PRAGMA foreign_keys = ON');
            this.db.run('PRAGMA journal_mode = WAL');
            this.db.run('PRAGMA synchronous = NORMAL');
          });

          // Initialize tables with clear flag
          this.initializeTables(true);
          this.logger.debug('Database cleared and reinitialized');
          resolve();
        });
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          this.logger.error(`Error closing database: ${err.message}`);
        } else {
          this.logger.info('Database connection closed');
        }
        resolve();
      });
    });
  }

  // Import session operations
  async createImportSession(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    providerId?: string,
    sessionMetadata?: unknown
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const db = this.db; // Capture db reference

      // Use a transaction to ensure the session is committed
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

  async deleteWalletAddress(id: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const query = 'DELETE FROM wallet_addresses WHERE id = ?';

      this.db.run(query, [id], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  async finalizeImportSession(
    sessionId: number,
    status: 'completed' | 'failed' | 'cancelled',
    startTime: number,
    transactionsImported = 0,
    transactionsFailed = 0,
    errorMessage?: string,
    errorDetails?: unknown
  ): Promise<void> {
    const durationMs = Date.now() - startTime;

    return this.updateImportSession(sessionId, {
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

  async findWalletAddressByAddress(address: string, blockchain: string): Promise<WalletAddress | undefined> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM wallet_addresses WHERE address = ? AND blockchain = ?';

      this.db.get(query, [address, blockchain], (err, row: WalletAddress) => {
        if (err) {
          reject(err);
        } else if (!row) {
          return;
        } else {
          resolve({
            address: row.address,
            addressType: row.addressType,
            blockchain: row.blockchain,
            createdAt: row.createdAt,
            id: row.id,
            isActive: Boolean(row.isActive),
            label: row.label,
            notes: row.notes,
            updatedAt: row.updatedAt,
          });
        }
      });
    });
  }

  async findWalletAddressByAddressNormalized(
    normalizedAddress: string,
    blockchain: string
  ): Promise<WalletAddress | undefined> {
    return new Promise((resolve, reject) => {
      // For Ethereum, do case-insensitive matching by comparing lowercase addresses
      let query: string;
      if (blockchain === 'ethereum') {
        query = 'SELECT * FROM wallet_addresses WHERE LOWER(address) = ? AND blockchain = ?';
      } else {
        query = 'SELECT * FROM wallet_addresses WHERE address = ? AND blockchain = ?';
      }

      this.db.get(query, [normalizedAddress, blockchain], (err, row: WalletAddress) => {
        if (err) {
          reject(err);
        } else if (!row) {
          return;
        } else {
          resolve({
            address: row.address,
            addressType: row.addressType,
            blockchain: row.blockchain,
            createdAt: row.createdAt,
            id: row.id,
            isActive: Boolean(row.isActive),
            label: row.label,
            notes: row.notes,
            updatedAt: row.updatedAt,
          });
        }
      });
    });
  }

  async getImportSession(sessionId: number): Promise<ImportSession | undefined> {
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

  async getImportSessions(filters?: ImportSessionQuery): Promise<ImportSession[]> {
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

  async getImportSessionsWithRawData(filters?: ImportSessionQuery): Promise<ImportSessionWithRawData[]> {
    return new Promise((resolve, reject) => {
      let query = `
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
      `;
      const params: (string | number)[] = [];
      const conditions: string[] = [];

      if (filters?.sourceId) {
        conditions.push('s.source_id = ?');
        params.push(filters.sourceId);
      }

      if (filters?.sourceType) {
        conditions.push('s.source_type = ?');
        params.push(filters.sourceType);
      }

      if (filters?.status) {
        conditions.push('s.status = ?');
        params.push(filters.status);
      }

      if (filters?.since) {
        conditions.push('s.started_at >= ?');
        params.push(filters.since);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY s.started_at DESC, r.created_at ASC';

      if (filters?.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      this.db.all(query, params, (err, rows: unknown[]) => {
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

  async getLatestBalanceVerifications(exchange?: string): Promise<BalanceVerificationRecord[]> {
    return new Promise((resolve, reject) => {
      let query = `
        SELECT * FROM balance_verifications
        WHERE timestamp = (
          SELECT MAX(timestamp) FROM balance_verifications bv2
          WHERE bv2.exchange = balance_verifications.exchange
          AND bv2.currency = balance_verifications.currency
        )
      `;
      const params: SQLParam[] = [];

      if (exchange) {
        query += ' AND exchange = ?';
        params.push(exchange);
      }

      query += ' ORDER BY exchange, currency';

      this.db.all(query, params, (err, rows: BalanceVerificationRecord[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getRawTransactions(filters?: {
    importSessionId?: number | undefined;
    processingStatus?: 'pending' | 'processed' | 'failed' | undefined;
    providerId?: string | undefined;
    since?: number | undefined;
    sourceId?: string | undefined;
  }): Promise<
    {
      createdAt: number;
      id: number;
      importSessionId?: number | undefined;
      metadata?: unknown;
      processedAt?: number | undefined;
      processingError?: string | undefined;
      processingStatus: string;
      providerId?: string | undefined;
      rawData: unknown;
      sourceId: string;
      sourceType: string;
    }[]
  > {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM external_transaction_data';
      const params: SQLParam[] = [];
      const conditions: string[] = [];

      if (filters?.sourceId) {
        conditions.push('source_id = ?');
        params.push(filters.sourceId);
      }

      if (filters?.importSessionId) {
        conditions.push('import_session_id = ?');
        params.push(filters.importSessionId);
      }

      if (filters?.providerId) {
        conditions.push('provider_id = ?');
        params.push(filters.providerId);
      }

      if (filters?.processingStatus) {
        conditions.push('processing_status = ?');
        params.push(filters.processingStatus);
      }

      if (filters?.since) {
        conditions.push('created_at >= ?');
        params.push(filters.since);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC';

      this.db.all(query, params, (err, rows: unknown[]) => {
        if (err) {
          reject(err);
        } else {
          const results = rows.map((row) => {
            const dbRow = row as Record<string, unknown>;
            return {
              createdAt: dbRow.created_at as number,
              id: dbRow.id as number,
              importSessionId: dbRow.import_session_id ? (dbRow.import_session_id as number) : undefined,
              metadata: dbRow.metadata ? (JSON.parse(dbRow.metadata as string) as Record<string, unknown>) : undefined,
              processedAt: dbRow.processed_at ? (dbRow.processed_at as number) : undefined,
              processingError: dbRow.processing_error ? (dbRow.processing_error as string) : undefined,
              processingStatus: dbRow.processing_status as string,
              providerId: dbRow.provider_id ? (dbRow.provider_id as string) : undefined,
              rawData: JSON.parse(dbRow.raw_data as string) as Record<string, unknown>,
              sourceId: dbRow.source_id as string,
              sourceType: dbRow.source_type as string,
            };
          });
          resolve(results);
        }
      });
    });
  }

  async getStats(): Promise<DatabaseStats> {
    return new Promise((resolve, reject) => {
      const queries = [
        'SELECT COUNT(*) as total_transactions FROM transactions',
        'SELECT COUNT(DISTINCT source_id) as total_sources FROM transactions',
        'SELECT source_id, COUNT(*) as count FROM transactions GROUP BY source_id',
        'SELECT COUNT(*) as total_verifications FROM balance_verifications',
        'SELECT COUNT(*) as total_snapshots FROM balance_snapshots',
        'SELECT COUNT(*) as total_external_transactions FROM external_transaction_data',
        'SELECT COUNT(*) as total_import_sessions FROM import_sessions',
      ];

      const results: DatabaseStats = {
        totalExchanges: 0,
        totalExternalTransactions: 0,
        totalImportSessions: 0,
        totalSnapshots: 0,
        totalTransactions: 0,
        totalVerifications: 0,
        transactionsByExchange: [],
      };

      this.db.serialize(() => {
        this.db.get(queries[0], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalTransactions = row.total_transactions || 0;
        });

        this.db.get(queries[1], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalExchanges = row.total_sources || 0;
        });

        this.db.all(queries[2], (err, rows: { count: number; source_id: string }[]) => {
          if (err) return reject(err);
          results.transactionsByExchange = rows.map((row) => ({ count: row.count, exchange: row.source_id }));
        });

        this.db.get(queries[3], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalVerifications = row.total_verifications || 0;
        });

        this.db.get(queries[4], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalSnapshots = row.total_snapshots || 0;
        });

        this.db.get(queries[5], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalExternalTransactions = row.total_external_transactions || 0;
        });

        this.db.get(queries[6], (err, row: StatRow) => {
          if (err) return reject(err);
          results.totalImportSessions = row.total_import_sessions || 0;
          resolve(results);
        });
      });
    });
  }

  async getTransactionCount(sourceId?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT COUNT(*) as count FROM transactions';
      const params: SQLParam[] = [];

      if (sourceId) {
        query += ' WHERE source_id = ?';
        params.push(sourceId);
      }

      this.db.get(query, params, (err, row: TransactionCountRow) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  // Wallet address management methods

  async getTransactions(sourceId?: string, since?: number): Promise<StoredTransaction[]> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM transactions';
      const params: SQLParam[] = [];

      if (sourceId || since) {
        query += ' WHERE';
        const conditions: string[] = [];

        if (sourceId) {
          conditions.push(' source_id = ?');
          params.push(sourceId);
        }

        if (since) {
          conditions.push(' timestamp >= ?');
          params.push(since);
        }

        query += conditions.join(' AND');
      }

      query += ' ORDER BY timestamp DESC';

      this.db.all(query, params, (err, rows: StoredTransaction[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getWalletAddress(id: number): Promise<WalletAddress | undefined> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM wallet_addresses WHERE id = ?';

      this.db.get<WalletAddress>(query, [id], (err, row: WalletAddress | undefined) => {
        if (err) {
          reject(err);
        } else if (!row) {
          return;
        } else {
          resolve({
            address: row.address,
            addressType: row.addressType,
            blockchain: row.blockchain,
            createdAt: row.createdAt,
            id: row.id,
            isActive: Boolean(row.isActive),
            label: row.label,
            notes: row.notes,
            updatedAt: row.updatedAt,
          });
        }
      });
    });
  }

  async getWalletAddresses(query?: WalletAddressQuery): Promise<WalletAddress[]> {
    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM wallet_addresses';
      const conditions: string[] = [];
      const params: SQLParam[] = [];

      if (query) {
        if (query.blockchain) {
          conditions.push('blockchain = ?');
          params.push(query.blockchain);
        }
        if (query.addressType) {
          conditions.push('address_type = ?');
          params.push(query.addressType);
        }
        if (query.isActive !== undefined) {
          conditions.push('is_active = ?');
          params.push(query.isActive ? 1 : 0);
        }
        if (query.search) {
          conditions.push('(address LIKE ? OR label LIKE ? OR notes LIKE ?)');
          const searchTerm = `%${query.search}%`;
          params.push(searchTerm, searchTerm, searchTerm);
        }
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY created_at DESC';

      this.db.all(sql, params, (err, rows: WalletAddress[]) => {
        if (err) {
          reject(err);
        } else {
          const addresses = rows.map((row) => ({
            address: row.address,
            addressType: row.addressType,
            blockchain: row.blockchain,
            createdAt: row.createdAt,
            id: row.id,
            isActive: Boolean(row.isActive),
            label: row.label,
            notes: row.notes,
            updatedAt: row.updatedAt,
          }));
          resolve(addresses);
        }
      });
    });
  }

  // Balance operations
  async saveBalanceSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO balance_snapshots
        (exchange, currency, balance, timestamp)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run([snapshot.exchange, snapshot.currency, String(snapshot.balance), snapshot.timestamp], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });

      stmt.finalize();
    });
  }

  async saveBalanceVerification(verification: BalanceVerificationRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO balance_verifications
        (exchange, currency, expected_balance, actual_balance, difference, status, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        [
          verification.exchange,
          verification.currency,
          String(verification.expected_balance),
          String(verification.actual_balance),
          String(verification.difference),
          verification.status,
          verification.timestamp,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );

      stmt.finalize();
    });
  }

  // Raw transaction operations
  async saveRawTransaction(
    sourceId: string,
    sourceType: string,
    rawData: unknown,
    options?: {
      importSessionId?: number | undefined;
      metadata?: unknown;
      providerId?: string | undefined;
    }
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO external_transaction_data
        (source_id, source_type, provider_id, raw_data, metadata, import_session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, provider_id) DO UPDATE SET
          raw_data = excluded.raw_data,
          metadata = excluded.metadata,
          import_session_id = excluded.import_session_id
      `);

      const providerId = options?.providerId || undefined;
      const rawDataJson = JSON.stringify(rawData);
      const metadataJson = options?.metadata ? JSON.stringify(options.metadata) : undefined;

      stmt.run(
        [sourceId, sourceType, providerId, rawDataJson, metadataJson, options?.importSessionId || undefined],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );

      stmt.finalize();
    });
  }

  async saveRawTransactions(
    sourceId: string,
    sourceType: string,
    rawTransactions: { data: unknown }[],
    options?: {
      importSessionId?: number | undefined;
      metadata?: unknown;
      providerId?: string | undefined;
    }
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let saved = 0;
      let completed = 0;
      const total = rawTransactions.length;
      let hasError = false;
      const db = this.db; // Capture db reference for use in callbacks

      if (total === 0) {
        resolve(0);
        return;
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) {
            return reject(err);
          }
        });

        const stmt = db.prepare(`
          INSERT OR IGNORE INTO external_transaction_data
          (source_id, source_type, provider_id, raw_data, metadata, import_session_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const rawTx of rawTransactions) {
          const providerId = options?.providerId || undefined;
          const rawDataJson = JSON.stringify(rawTx.data);
          const metadataJson = options?.metadata ? JSON.stringify(options.metadata) : undefined;
          const importSessionId = options?.importSessionId || undefined;

          stmt.run([sourceId, sourceType, providerId, rawDataJson, metadataJson, importSessionId], function (err) {
            completed++;

            if (err && !err.message.includes('UNIQUE constraint failed')) {
              if (!hasError) {
                hasError = true;
                stmt.finalize();
                db.run('ROLLBACK', () => {
                  reject(err);
                });
              }
              return;
            }

            if (this.changes > 0) saved++;

            // Check if all operations are complete
            if (completed === total && !hasError) {
              stmt.finalize();
              db.run('COMMIT', (commitErr) => {
                if (commitErr) {
                  reject(commitErr);
                } else {
                  resolve(saved);
                }
              });
            }
          });
        }
      });
    });
  }

  // Transaction operations
  async saveTransaction(transaction: UniversalTransaction): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO transactions
        (source_id, type, timestamp, datetime, symbol, amount, amount_currency, price, price_currency, fee_cost, fee_currency, status, from_address, to_address, raw_data, hash, verified, note_type, note_message, note_severity, note_metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const rawDataJson = JSON.stringify(transaction);

      // Extract currencies from Money type
      let amountCurrency: string | undefined;
      let priceCurrency: string | undefined;

      // Primary: Extract from Money type structure
      if (transaction.amount && typeof transaction.amount === 'object' && transaction.amount.currency) {
        amountCurrency = transaction.amount.currency;
      }

      if (transaction.price && typeof transaction.price === 'object' && transaction.price.currency) {
        priceCurrency = transaction.price.currency;
      }

      stmt.run(
        [
          transaction.source,
          transaction.type || 'unknown',
          transaction.timestamp || Date.now(),
          transaction.datetime || undefined,
          transaction.symbol || undefined,
          typeof transaction.amount === 'object'
            ? moneyToDbString(transaction.amount)
            : transaction.amount
              ? String(transaction.amount)
              : undefined,
          amountCurrency,
          typeof transaction.price === 'object'
            ? moneyToDbString(transaction.price)
            : transaction.price
              ? String(transaction.price)
              : undefined,
          priceCurrency,
          typeof transaction.fee === 'object' ? moneyToDbString(transaction.fee) : undefined,
          typeof transaction.fee === 'object' ? transaction.fee.currency : undefined,
          transaction.status || undefined,
          transaction.from || undefined,
          transaction.to || undefined,
          rawDataJson,
          transaction.metadata?.hash || `${transaction.source}-${transaction.id}`,
          transaction.metadata?.verified ? 1 : 0,
          transaction.note?.type || undefined,
          transaction.note?.message || undefined,
          transaction.note?.severity || undefined,
          transaction.note?.metadata ? JSON.stringify(transaction.note.metadata) : undefined,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );

      stmt.finalize();
    });
  }

  async saveTransactions(transactions: UniversalTransaction[]): Promise<number> {
    return new Promise((resolve, reject) => {
      let saved = 0;

      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');

        const stmt = this.db.prepare(`
          INSERT OR IGNORE INTO transactions
          (source_id, type, timestamp, datetime, symbol, amount, amount_currency, price, price_currency, fee_cost, fee_currency, status, from_address, to_address, wallet_id, raw_data, hash, verified, note_type, note_message, note_severity, note_metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const transaction of transactions) {
          const rawDataJson = JSON.stringify(transaction);

          // Extract currencies from Money type or fallback to legacy extraction
          let amountCurrency: string | undefined;
          let priceCurrency: string | undefined;

          // Primary: Extract from Money type structure
          if (transaction.amount && typeof transaction.amount === 'object' && transaction.amount.currency) {
            amountCurrency = transaction.amount.currency;
          }

          if (transaction.price && typeof transaction.price === 'object' && transaction.price.currency) {
            priceCurrency = transaction.price.currency;
          }

          // wallet_id will be updated later by the linkTransactionAddresses method
          const walletId = undefined;

          stmt.run(
            [
              transaction.source,
              transaction.type || 'unknown',
              transaction.timestamp || Date.now(),
              transaction.datetime || undefined,
              transaction.symbol || undefined,
              typeof transaction.amount === 'object'
                ? moneyToDbString(transaction.amount)
                : transaction.amount
                  ? String(transaction.amount)
                  : undefined,
              amountCurrency,
              typeof transaction.price === 'object'
                ? moneyToDbString(transaction.price)
                : transaction.price
                  ? String(transaction.price)
                  : undefined,
              priceCurrency,
              typeof transaction.fee === 'object' ? moneyToDbString(transaction.fee) : undefined,
              typeof transaction.fee === 'object' ? transaction.fee.currency : undefined,
              transaction.status || undefined,
              transaction.from || undefined,
              transaction.to || undefined,
              walletId,
              rawDataJson,
              transaction.metadata?.hash || `${transaction.source}-${transaction.id}`,
              transaction.metadata?.verified ? 1 : 0,
              transaction.note?.type || undefined,
              transaction.note?.message || undefined,
              transaction.note?.severity || undefined,
              transaction.note?.metadata ? JSON.stringify(transaction.note.metadata) : undefined,
            ],
            function (err) {
              if (err && !err.message.includes('UNIQUE constraint failed')) {
                stmt.finalize();
                return reject(err);
              }
              if (this.changes > 0) saved++;
            }
          );
        }

        stmt.finalize();

        this.db.run('COMMIT', (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(saved);
          }
        });
      });
    });
  }

  async updateImportSession(sessionId: number, updates: UpdateImportSessionRequest): Promise<void> {
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

  async updateRawTransactionProcessingStatus(
    rawTransactionId: number,
    status: 'pending' | 'processed' | 'failed',
    error?: string,
    providerId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        UPDATE external_transaction_data
        SET processing_status = ?, processing_error = ?, processed_at = ?
        WHERE id = ? AND (provider_id = ? OR (provider_id IS undefined AND ? IS undefined))
      `);

      const processedAt = status === 'processed' ? Math.floor(Date.now() / 1000) : undefined;

      stmt.run(
        [status, error || undefined, processedAt, rawTransactionId, providerId || undefined, providerId || undefined],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );

      stmt.finalize();
    });
  }

  async updateWalletAddress(id: number, updates: UpdateWalletAddressRequest): Promise<WalletAddress | undefined> {
    return new Promise((resolve, reject) => {
      const now = Math.floor(Date.now() / 1000);
      const setParts: string[] = [];
      const params: SQLParam[] = [];

      if (updates.label !== undefined) {
        setParts.push('label = ?');
        params.push(updates.label);
      }
      if (updates.addressType !== undefined) {
        setParts.push('address_type = ?');
        params.push(updates.addressType);
      }
      if (updates.isActive !== undefined) {
        setParts.push('is_active = ?');
        params.push(updates.isActive ? 1 : 0);
      }
      if (updates.notes !== undefined) {
        setParts.push('notes = ?');
        params.push(updates.notes);
      }

      if (setParts.length === 0) {
        this.getWalletAddress(id).then(resolve).catch(reject);
        return;
      }

      setParts.push('updated_at = ?');
      params.push(now);
      params.push(id);

      const query = `UPDATE wallet_addresses SET ${setParts.join(', ')} WHERE id = ?`;

      this.db.run(query, params, (err) => {
        if (err) {
          reject(err);
        } else {
          this.getWalletAddress(id).then(resolve).catch(reject);
        }
      });
    });
  }

  // Utility methods
  async vacuum(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('VACUUM', (err) => {
        if (err) {
          reject(err);
        } else {
          this.logger.info('Database vacuumed');
          resolve();
        }
      });
    });
  }

  private initializeTables(clearExisting = false): void {
    const tableQueries: string[] = [];

    if (clearExisting) {
      tableQueries.push(
        `DROP TABLE IF EXISTS transactions`,
        `DROP TABLE IF EXISTS external_transaction_data`,
        `DROP TABLE IF EXISTS raw_transactions`,
        `DROP TABLE IF EXISTS balance_snapshots`,
        `DROP TABLE IF EXISTS balance_verifications`,
        `DROP TABLE IF EXISTS wallet_addresses`,
        `DROP TABLE IF EXISTS import_sessions`
      );
    }

    tableQueries.push(
      // Import sessions table - tracks import session metadata and execution details
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}import_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT undefined,
        source_type TEXT NOT undefined CHECK (source_type IN ('exchange', 'blockchain')),
        provider_id TEXT,
        status TEXT NOT undefined DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed', 'cancelled')),
        started_at INTEGER NOT undefined DEFAULT (strftime('%s','now')),
        completed_at INTEGER,
        duration_ms INTEGER,
        error_message TEXT,
        error_details JSON,
        session_metadata JSON,
        transactions_imported INTEGER DEFAULT 0,
        transactions_failed INTEGER DEFAULT 0,
        created_at INTEGER NOT undefined DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT undefined DEFAULT (strftime('%s','now'))
      )`,

      // External transaction data table - stores unprocessed transaction data from sources
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}external_transaction_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT undefined,
        source_type TEXT NOT undefined,
        provider_id TEXT,
        raw_data JSON NOT undefined,
        metadata JSON,
        processing_status TEXT DEFAULT 'pending',
        processing_error TEXT,
        processed_at INTEGER,
        created_at INTEGER NOT undefined DEFAULT (strftime('%s','now')),
        import_session_id INTEGER,
        UNIQUE(source_id, provider_id),
        FOREIGN KEY (import_session_id) REFERENCES import_sessions (id)
      )`,

      // Transactions table - stores transactions from all sources with standardized structure
      // Using TEXT for decimal values to preserve precision
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT undefined,
        type TEXT NOT undefined,
        timestamp INTEGER NOT undefined,
        datetime TEXT,
        symbol TEXT,
        amount TEXT,
        amount_currency TEXT,
        price TEXT,
        price_currency TEXT,
        fee_cost TEXT,
        fee_currency TEXT,
        status TEXT,
        from_address TEXT,
        to_address TEXT,
        wallet_id INTEGER,
        raw_data JSON NOT undefined,
        created_at INTEGER NOT undefined DEFAULT (strftime('%s','now')),
        hash TEXT,
        verified BOOLEAN DEFAULT 0,
        note_type TEXT,
        note_message TEXT,
        note_severity TEXT CHECK (note_severity IN ('info', 'warning', 'error')),
        note_metadata JSON,
        FOREIGN KEY (wallet_id) REFERENCES wallet_addresses (id)
      )`,

      // Balance snapshots - store point-in-time balance data
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange TEXT NOT undefined,
        currency TEXT NOT undefined,
        balance TEXT NOT undefined,
        timestamp INTEGER NOT undefined,
        created_at INTEGER NOT undefined DEFAULT (strftime('%s','now'))
      )`,

      // Balance verification records - track verification results
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}balance_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange TEXT NOT undefined,
        currency TEXT NOT undefined,
        expected_balance TEXT NOT undefined,
        actual_balance TEXT NOT undefined,
        difference TEXT NOT undefined,
        status TEXT NOT undefined CHECK (status IN ('match', 'mismatch', 'warning')),
        timestamp INTEGER NOT undefined,
        created_at INTEGER NOT undefined DEFAULT (strftime('%s','now'))
      )`,

      // Wallet addresses - store user's wallet addresses for tracking and consolidation
      `CREATE TABLE ${clearExisting ? '' : 'IF NOT EXISTS '}wallet_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT undefined,
        blockchain TEXT NOT undefined,
        label TEXT,
        address_type TEXT NOT undefined DEFAULT 'personal' CHECK (address_type IN ('personal', 'exchange', 'contract', 'unknown')),
        is_active BOOLEAN DEFAULT 1,
        notes TEXT,
        created_at INTEGER NOT undefined DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT undefined DEFAULT (strftime('%s','now')),
        UNIQUE(address, blockchain)
      )`
    );

    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_transactions_source_timestamp
       ON transactions(source_id, timestamp)`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_type_timestamp
       ON transactions(type, timestamp)`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_symbol
       ON transactions(symbol) WHERE symbol IS NOT undefined`,

      `CREATE INDEX IF NOT EXISTS idx_balance_snapshots_exchange_currency
       ON balance_snapshots(exchange, currency, timestamp)`,

      `CREATE INDEX IF NOT EXISTS idx_balance_verifications_exchange_timestamp
       ON balance_verifications(exchange, timestamp)`,

      // New indexes for wallet address tracking
      `CREATE INDEX IF NOT EXISTS idx_transactions_from_address
       ON transactions(from_address) WHERE from_address IS NOT undefined`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_to_address
       ON transactions(to_address) WHERE to_address IS NOT undefined`,

      `CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id
       ON transactions(wallet_id) WHERE wallet_id IS NOT undefined`,

      `CREATE INDEX IF NOT EXISTS idx_wallet_addresses_blockchain_address
       ON wallet_addresses(blockchain, address)`,

      `CREATE INDEX IF NOT EXISTS idx_wallet_addresses_active
       ON wallet_addresses(is_active) WHERE is_active = 1`,

      // Import sessions indexes
      `CREATE INDEX IF NOT EXISTS idx_import_sessions_source
       ON import_sessions(source_id, started_at)`,

      `CREATE INDEX IF NOT EXISTS idx_import_sessions_status
       ON import_sessions(status, started_at)`,

      `CREATE INDEX IF NOT EXISTS idx_import_sessions_source_type
       ON import_sessions(source_type, started_at)`,

      // External transaction data indexes
      `CREATE INDEX IF NOT EXISTS idx_external_transaction_data_source
       ON external_transaction_data(source_id, created_at)`,

      `CREATE INDEX IF NOT EXISTS idx_external_transaction_data_session
       ON external_transaction_data(import_session_id) WHERE import_session_id IS NOT undefined`,
    ];

    this.db.serialize(() => {
      for (const query of tableQueries) {
        this.db.run(query, (err) => {
          if (err) {
            this.logger.error(`Failed to create table: ${err.message} (query: ${query})`);
          }
        });
      }

      // Then create indexes after tables are complete
      for (const query of indexQueries) {
        this.db.run(query, (err) => {
          if (err) {
            this.logger.error(`Failed to create index: ${err.message} (query: ${query})`);
          }
        });
      }
    });

    this.logger.debug('Database tables initialized');
  }
}

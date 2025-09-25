import type { UniversalTransaction } from '@crypto/core';
import type { StoredTransaction, StoredRawData } from '@crypto/data';
import type { Decimal } from 'decimal.js';
import type sqlite3Module from 'sqlite3';

import type { ITransactionRepository } from '../../app/ports/transaction-repository.ts';

export interface RawTransactionFilters {
  importSessionId?: number | undefined;
  processingStatus?: 'pending' | 'processed' | 'failed' | undefined;
  providerId?: string | undefined;
  since?: number | undefined;
  sourceId?: string | undefined;
}

export interface SaveRawTransactionOptions {
  importSessionId?: number | undefined;
  metadata?: unknown;
  providerId?: string | undefined;
}

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

// Local utility function to avoid cyclic dependency
function moneyToDbString(money: { amount: Decimal | number; currency: string }): string {
  if (typeof money.amount === 'number') {
    return String(money.amount);
  }
  return money.amount.toString();
}

/**
 * Repository for transaction-related database operations.
 * Handles both regular transactions and raw external transaction data.
 */
export class TransactionRepository implements ITransactionRepository {
  constructor(private db: SQLiteDatabase) {}

  // ITransactionRepository implementation
  async save(transaction: UniversalTransaction): Promise<number> {
    return this.saveTransaction(transaction);
  }

  async saveBatch(transactions: UniversalTransaction[]): Promise<number> {
    return this.saveTransactions(transactions);
  }

  // Regular transaction operations
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

          // Extract currencies from Money type
          let amountCurrency: string | undefined;
          let priceCurrency: string | undefined;

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

  async getTransactions(sourceId?: string, since?: number): Promise<StoredTransaction[]> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM transactions';
      const params: (string | number)[] = [];

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

  async getTransactionCount(sourceId?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT COUNT(*) as count FROM transactions';
      const params: (string | number)[] = [];

      if (sourceId) {
        query += ' WHERE source_id = ?';
        params.push(sourceId);
      }

      this.db.get(query, params, (err, row: { count: number }) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  // Raw transaction operations
  async saveRawTransaction(
    sourceId: string,
    sourceType: string,
    rawData: unknown,
    options?: SaveRawTransactionOptions
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
    options?: SaveRawTransactionOptions
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let saved = 0;
      let completed = 0;
      const total = rawTransactions.length;
      let hasError = false;
      const db = this.db;

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

  async getRawTransactions(filters?: RawTransactionFilters): Promise<StoredRawData[]> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM external_transaction_data';
      const params: (string | number)[] = [];
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
}

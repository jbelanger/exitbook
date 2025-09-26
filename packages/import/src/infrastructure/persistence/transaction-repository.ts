import type { UniversalTransaction } from '@crypto/core';
import type { StoredTransaction } from '@crypto/data';
import type { Decimal } from 'decimal.js';
import type sqlite3Module from 'sqlite3';

import type { ITransactionRepository } from '../../app/ports/transaction-repository.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

// Local utility function to avoid cyclic dependency
function moneyToDbString(money: { amount: Decimal | number; currency: string }): string {
  if (typeof money.amount === 'number') {
    return String(money.amount);
  }
  return money.amount.toString();
}

/**
 * Repository for transaction database operations.
 * Handles storage and retrieval of UniversalTransaction entities.
 */
export class TransactionRepository implements ITransactionRepository {
  constructor(private db: SQLiteDatabase) {}

  async save(transaction: UniversalTransaction): Promise<number> {
    return this.saveTransaction(transaction);
  }

  async saveBatch(transactions: UniversalTransaction[]): Promise<number> {
    return this.saveTransactions(transactions);
  }
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
}

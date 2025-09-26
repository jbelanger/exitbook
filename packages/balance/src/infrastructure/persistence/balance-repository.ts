import type { StoredTransaction } from '@crypto/data/src/types/data-types.ts';
import type { SQLParam } from '@crypto/data/src/types/database-types.ts';
import type sqlite3Module from 'sqlite3';

import type { BalanceSnapshot, BalanceVerificationRecord } from '../../types/balance-types.ts';

type SQLiteDatabase = InstanceType<typeof sqlite3Module.Database>;

export class BalanceRepository {
  constructor(private db: SQLiteDatabase) {}

  async getLatestVerifications(exchange?: string): Promise<BalanceVerificationRecord[]> {
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

  async getTransactionsForCalculation(exchange: string): Promise<StoredTransaction[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT
          source_id,
          symbol,
          type,
          amount,
          amount_currency,
          price,
          price_currency,
          fee_cost,
          fee_currency,
          raw_data
        FROM transactions
        WHERE source_id = ?
        ORDER BY timestamp ASC
      `;

      this.db.all(query, [exchange], (err: Error | null, rows: StoredTransaction[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
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

  async saveVerification(verification: BalanceVerificationRecord): Promise<void> {
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
}

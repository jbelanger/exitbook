import type { BalanceSnapshot, BalanceVerificationRecord } from '@crypto/balance';
import { Database } from '../storage/database.ts';
import type { StoredTransaction } from '../types/data-types.js';

export class BalanceRepository {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    return this.database.saveBalanceSnapshot(snapshot);
  }

  async saveVerification(verification: BalanceVerificationRecord): Promise<void> {
    return this.database.saveBalanceVerification(verification);
  }

  async getLatestVerifications(exchange?: string): Promise<BalanceVerificationRecord[]> {
    return this.database.getLatestBalanceVerifications(exchange);
  }

  async getTransactionsForCalculation(exchange: string): Promise<StoredTransaction[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          symbol,
          type,
          amount,
          amount_currency,
          side,
          price,
          price_currency,
          fee_cost,
          fee_currency,
          raw_data
        FROM transactions 
        WHERE exchange = ?
        ORDER BY timestamp ASC
      `;

      this.database['db'].all(query, [exchange], (err: Error | null, rows: StoredTransaction[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as StoredTransaction[]);
        }
      });
    });
  }
}
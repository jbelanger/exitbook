import type { Database } from '@crypto/data/src/storage/database.ts';
import type { StoredTransaction } from '@crypto/data/src/types/data-types.ts';

import type { BalanceSnapshot, BalanceVerificationRecord } from '../../types/balance-types.ts';

export class BalanceRepository {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async getLatestVerifications(exchange?: string): Promise<BalanceVerificationRecord[]> {
    return this.database.getLatestBalanceVerifications(exchange);
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

      this.database['db'].all(query, [exchange], (err: Error | null, rows: StoredTransaction[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    return this.database.saveBalanceSnapshot(snapshot);
  }

  async saveVerification(verification: BalanceVerificationRecord): Promise<void> {
    return this.database.saveBalanceVerification(verification);
  }
}

import type { BalanceSnapshot, BalanceVerificationRecord } from '@crypto/core';
import { Database } from '../storage/database.ts';

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

  async calculateBalances(exchange: string): Promise<Record<string, number>> {
    return this.database.calculateBalances(exchange);
  }
}
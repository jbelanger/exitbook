import type { EnhancedTransaction } from '@crypto/core';
import type { StoredTransaction } from '../types/data-types.js';
import { Database } from '../storage/database.ts';

export class TransactionRepository {
  private database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async save(transaction: EnhancedTransaction): Promise<void> {
    return this.database.saveTransaction(transaction);
  }

  async saveMany(transactions: EnhancedTransaction[]): Promise<number> {
    return this.database.saveTransactions(transactions);
  }

  async findAll(exchange?: string, since?: number): Promise<StoredTransaction[]> {
    return this.database.getTransactions(exchange, since);
  }

  async count(exchange?: string): Promise<number> {
    return this.database.getTransactionCount(exchange);
  }

  async updateAddresses(transactionId: string, fromAddress?: string, toAddress?: string, walletId?: number): Promise<void> {
    return this.database.updateTransactionAddresses(transactionId, fromAddress, toAddress, walletId);
  }
}
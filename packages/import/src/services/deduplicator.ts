import type { UniversalTransaction } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { moneyToNumber } from '@crypto/shared-utils';
import { createHash } from 'crypto';


interface DeduplicationResult {
  unique: UniversalTransaction[];
  duplicates: UniversalTransaction[];
}

export class Deduplicator {
  private logger = getLogger('Deduplicator');

  async process(transactions: UniversalTransaction[], sourceId: string): Promise<DeduplicationResult> {
    this.logger.info(`Starting deduplication for ${transactions.length} transactions from ${sourceId}`);

    const result = this.deduplicateByHash(transactions, sourceId);
    this.logDeduplicationStats(result, sourceId);
    
    return result;
  }

  async processAdvanced(transactions: UniversalTransaction[], sourceId: string): Promise<DeduplicationResult> {
    this.logger.info(`Starting advanced deduplication for ${transactions.length} transactions from ${sourceId}`);

    const result = this.deduplicateBySimilarity(transactions, sourceId);
    this.logDeduplicationStats(result, sourceId, 'advanced');
    
    return result;
  }

  private normalizeAmount(amount: number): string {
    // Normalize amount to handle floating point precision issues
    return amount.toFixed(8);
  }

  // Method to detect potential data quality issues
  detectAnomalies(transactions: UniversalTransaction[]): {
    missingIds: UniversalTransaction[];
    invalidTimestamps: UniversalTransaction[];
    zeroAmounts: UniversalTransaction[];
    missingSymbols: UniversalTransaction[];
  } {
    const anomalies = {
      missingIds: [] as UniversalTransaction[],
      invalidTimestamps: [] as UniversalTransaction[],
      zeroAmounts: [] as UniversalTransaction[],
      missingSymbols: [] as UniversalTransaction[]
    };

    for (const tx of transactions) {
      // Check for missing IDs
      if (!tx.id) {
        anomalies.missingIds.push(tx);
      }

      // Check for invalid timestamps
      if (!tx.timestamp || tx.timestamp <= 0 || tx.timestamp > Date.now() + 86400000) { // Future date + 1 day tolerance
        anomalies.invalidTimestamps.push(tx);
      }

      // Check for zero amounts in trades (might be valid for some transaction types)
      const amount = moneyToNumber(tx.amount);
      if (tx.type === 'trade' && (!amount || amount === 0)) {
        anomalies.zeroAmounts.push(tx);
      }

      // Check for missing symbols in trades
      if (tx.type === 'trade' && !tx.symbol) {
        anomalies.missingSymbols.push(tx);
      }
    }

    if (Object.values(anomalies).some(arr => arr.length > 0)) {
      this.logger.warn(`Data quality issues detected - Missing IDs: ${anomalies.missingIds.length}, Invalid timestamps: ${anomalies.invalidTimestamps.length}, Zero amounts: ${anomalies.zeroAmounts.length}, Missing symbols: ${anomalies.missingSymbols.length}`);
    }

    return anomalies;
  }

  // Get statistics about the deduplication process
  getDeduplicationStats(result: DeduplicationResult): { total: number; unique: number; duplicates: number; duplicateRate: number } {
    const total = result.unique.length + result.duplicates.length;

    return {
      total,
      unique: result.unique.length,
      duplicates: result.duplicates.length,
      duplicateRate: total > 0 ? (result.duplicates.length / total) * 100 : 0
    };
  }

  private deduplicateByHash(transactions: UniversalTransaction[], sourceId: string): DeduplicationResult {
    const unique: UniversalTransaction[] = [];
    const duplicates: UniversalTransaction[] = [];
    const seenHashes = new Set<string>();

    for (const transaction of transactions) {
      const hash = this.createTransactionHash(transaction);

      if (seenHashes.has(hash)) {
        duplicates.push(transaction);
        this.logDuplicateTransaction(transaction.id, sourceId);
      } else {
        seenHashes.add(hash);
        unique.push(transaction);
      }
    }

    return { unique, duplicates };
  }

  private deduplicateBySimilarity(transactions: UniversalTransaction[], sourceId: string): DeduplicationResult {
    const unique: UniversalTransaction[] = [];
    const duplicates: UniversalTransaction[] = [];
    const transactionIndex = new Map<string, UniversalTransaction>();

    for (const transaction of transactions) {
      const primaryKey = this.createPrimaryKey(transaction);
      const existingTransaction = transactionIndex.get(primaryKey);

      if (existingTransaction) {
        if (this.areTransactionsSimilar(existingTransaction, transaction)) {
          duplicates.push(transaction);
          this.logDuplicateTransaction(transaction.id, sourceId);
        } else {
          unique.push(transaction);
          transactionIndex.set(primaryKey + '_' + unique.length, transaction);
        }
      } else {
        transactionIndex.set(primaryKey, transaction);
        unique.push(transaction);
      }
    }

    return { unique, duplicates };
  }

  private createPrimaryKey(transaction: UniversalTransaction): string {
    // Create a key based on core transaction properties
    const keyParts = [
      transaction.source,
      transaction.type,
      Math.floor(transaction.timestamp / 1000), // Round to seconds to handle minor timestamp differences
      transaction.symbol || '',
      this.normalizeAmount(moneyToNumber(transaction.amount)),
      transaction.metadata?.side || ''
    ];

    return keyParts.join('|');
  }

  private areTransactionsSimilar(tx1: UniversalTransaction, tx2: UniversalTransaction): boolean {
    // Define similarity criteria
    const timestampDiff = Math.abs(tx1.timestamp - tx2.timestamp);
    const timestampTolerance = 5000; // 5 seconds

    const amount1 = moneyToNumber(tx1.amount);
    const amount2 = moneyToNumber(tx2.amount);
    const amountDiff = Math.abs(amount1 - amount2);
    const amountTolerance = 0.00000001; // Satoshi-level tolerance

    return (
      tx1.source === tx2.source &&
      tx1.type === tx2.type &&
      tx1.symbol === tx2.symbol &&
      (tx1.metadata?.side || '') === (tx2.metadata?.side || '') &&
      timestampDiff <= timestampTolerance &&
      amountDiff <= amountTolerance
    );
  }

  private createTransactionHash(transaction: UniversalTransaction): string {
    // Create a hash from key transaction properties for deduplication
    const hashData = JSON.stringify({
      id: transaction.id,
      timestamp: transaction.timestamp,
      symbol: transaction.symbol,
      amount: transaction.amount,
      side: transaction.metadata?.side,
      type: transaction.type,
      source: transaction.source
    });

    return createHash('sha256').update(hashData).digest('hex').slice(0, 16);
  }

  private logDeduplicationStats(result: DeduplicationResult, sourceId: string, mode: string = 'standard'): void {
    const total = result.unique.length + result.duplicates.length;
    const duplicatePercentage = total > 0 ? ((result.duplicates.length / total) * 100).toFixed(2) : '0.00';
    
    this.logger.info(`${mode.charAt(0).toUpperCase() + mode.slice(1)} deduplication completed for ${sourceId} - Total: ${total}, Unique: ${result.unique.length}, Duplicates: ${result.duplicates.length} (${duplicatePercentage}%)`);
  }

  private logDuplicateTransaction(transactionId: string, sourceId: string): void {
    this.logger.debug(`Duplicate transaction skipped - ID: ${transactionId}, Source: ${sourceId}, Timestamp: ${Date.now()}`);
  }
}
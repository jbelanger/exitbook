import type { EnhancedTransaction } from '../../core/types/index';
import { Logger } from '../../infrastructure/logging';
import { moneyToNumber } from '../../utils/decimal-utils';


interface DeduplicationResult {
  unique: EnhancedTransaction[];
  duplicates: EnhancedTransaction[];
}

export class Deduplicator {
  private logger = new Logger('Deduplicator');

  async process(transactions: EnhancedTransaction[], exchangeId: string): Promise<DeduplicationResult> {
    this.logger.info(`Starting deduplication for ${transactions.length} transactions from ${exchangeId}`);

    const unique: EnhancedTransaction[] = [];
    const duplicates: EnhancedTransaction[] = [];
    const seenHashes = new Set<string>();

    for (const transaction of transactions) {
      const hash = transaction.hash;

      if (seenHashes.has(hash)) {
        duplicates.push(transaction);
        this.logger.logDuplicateTransaction(transaction.id || hash, exchangeId);
      } else {
        seenHashes.add(hash);
        unique.push(transaction);
      }
    }

    this.logger.info(`Deduplication completed for ${exchangeId}`, {
      total: transactions.length,
      unique: unique.length,
      duplicates: duplicates.length,
      duplicatePercentage: ((duplicates.length / transactions.length) * 100).toFixed(2)
    });

    return { unique, duplicates };
  }

  // Advanced deduplication that can handle slight variations in transaction data
  async processAdvanced(transactions: EnhancedTransaction[], exchangeId: string): Promise<DeduplicationResult> {
    this.logger.info(`Starting advanced deduplication for ${transactions.length} transactions from ${exchangeId}`);

    const unique: EnhancedTransaction[] = [];
    const duplicates: EnhancedTransaction[] = [];
    const transactionIndex = new Map<string, EnhancedTransaction>();

    for (const transaction of transactions) {
      const primaryKey = this.createPrimaryKey(transaction);
      const existingTransaction = transactionIndex.get(primaryKey);

      if (existingTransaction) {
        // Found a potential duplicate
        if (this.areTransactionsSimilar(existingTransaction, transaction)) {
          duplicates.push(transaction);
          this.logger.logDuplicateTransaction(transaction.id || transaction.hash, exchangeId);
        } else {
          // Similar key but different transaction, keep both
          unique.push(transaction);
          // Update the index with a modified key to avoid future conflicts
          transactionIndex.set(primaryKey + '_' + unique.length, transaction);
        }
      } else {
        transactionIndex.set(primaryKey, transaction);
        unique.push(transaction);
      }
    }

    this.logger.info(`Advanced deduplication completed for ${exchangeId}`, {
      total: transactions.length,
      unique: unique.length,
      duplicates: duplicates.length,
      duplicatePercentage: ((duplicates.length / transactions.length) * 100).toFixed(2)
    });

    return { unique, duplicates };
  }

  private createPrimaryKey(transaction: EnhancedTransaction): string {
    // Create a key based on core transaction properties
    // This is more flexible than just using the hash
    const keyParts = [
      transaction.source,
      transaction.type,
      Math.floor((transaction.timestamp || 0) / 1000), // Round to seconds to handle minor timestamp differences
      transaction.symbol || '',
      this.normalizeAmount(typeof transaction.amount === 'object' ? moneyToNumber(transaction.amount) : (transaction.amount || 0)),
      transaction.side || ''
    ];

    return keyParts.join('|');
  }

  private areTransactionsSimilar(tx1: EnhancedTransaction, tx2: EnhancedTransaction): boolean {
    // Define similarity criteria
    const timestampDiff = Math.abs((tx1.timestamp || 0) - (tx2.timestamp || 0));
    const timestampTolerance = 5000; // 5 seconds

    const amount1 = typeof tx1.amount === 'object' ? moneyToNumber(tx1.amount) : (tx1.amount || 0);
    const amount2 = typeof tx2.amount === 'object' ? moneyToNumber(tx2.amount) : (tx2.amount || 0);
    const amountDiff = Math.abs(amount1 - amount2);
    const amountTolerance = 0.00000001; // Satoshi-level tolerance

    return (
      tx1.source === tx2.source &&
      tx1.type === tx2.type &&
      tx1.symbol === tx2.symbol &&
      tx1.side === tx2.side &&
      timestampDiff <= timestampTolerance &&
      amountDiff <= amountTolerance
    );
  }

  private normalizeAmount(amount: number): string {
    // Normalize amount to handle floating point precision issues
    return amount.toFixed(8);
  }

  // Method to detect potential data quality issues
  detectAnomalies(transactions: EnhancedTransaction[]): {
    missingIds: EnhancedTransaction[];
    invalidTimestamps: EnhancedTransaction[];
    zeroAmounts: EnhancedTransaction[];
    missingSymbols: EnhancedTransaction[];
  } {
    const anomalies = {
      missingIds: [] as EnhancedTransaction[],
      invalidTimestamps: [] as EnhancedTransaction[],
      zeroAmounts: [] as EnhancedTransaction[],
      missingSymbols: [] as EnhancedTransaction[]
    };

    for (const tx of transactions) {
      // Check for missing IDs
      if (!tx.id && !tx.hash) {
        anomalies.missingIds.push(tx);
      }

      // Check for invalid timestamps
      if (!tx.timestamp || tx.timestamp <= 0 || tx.timestamp > Date.now() + 86400000) { // Future date + 1 day tolerance
        anomalies.invalidTimestamps.push(tx);
      }

      // Check for zero amounts in trades (might be valid for some transaction types)
      const amount = typeof tx.amount === 'object' ? moneyToNumber(tx.amount) : tx.amount;
      if (tx.type === 'trade' && (!amount || amount === 0)) {
        anomalies.zeroAmounts.push(tx);
      }

      // Check for missing symbols in trades
      if (tx.type === 'trade' && !tx.symbol) {
        anomalies.missingSymbols.push(tx);
      }
    }

    if (Object.values(anomalies).some(arr => arr.length > 0)) {
      this.logger.warn('Data quality issues detected', {
        missingIds: anomalies.missingIds.length,
        invalidTimestamps: anomalies.invalidTimestamps.length,
        zeroAmounts: anomalies.zeroAmounts.length,
        missingSymbols: anomalies.missingSymbols.length
      });
    }

    return anomalies;
  }

  // Get statistics about the deduplication process
  getDeduplicationStats(result: DeduplicationResult): any {
    const total = result.unique.length + result.duplicates.length;

    return {
      total,
      unique: result.unique.length,
      duplicates: result.duplicates.length,
      duplicateRate: total > 0 ? (result.duplicates.length / total) * 100 : 0,
      efficiency: total > 0 ? (result.unique.length / total) * 100 : 0
    };
  }
} 
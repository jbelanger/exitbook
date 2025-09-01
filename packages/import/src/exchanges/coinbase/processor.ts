import type { UniversalTransaction } from '@crypto/core';
import type { StoredRawData } from '@crypto/data';
import { type Result, err, ok } from 'neverthrow';

import { BaseProcessor } from '../../shared/processors/base-processor.ts';

/**
 * Processor for Coinbase transactions.
 *
 * Since the CoinbaseCCXTAdapter already transforms raw ledger entries into
 * UniversalTransaction format with proper grouping and fee deduplication,
 * this processor primarily handles validation and any final adjustments.
 *
 * Key features handled by the CCXT adapter:
 * - Ledger entry grouping (multiple entries per trade)
 * - Fee deduplication (same fee appears in multiple entries)
 * - Trade reconstruction (combining buy/sell sides)
 * - Direction-based transaction type mapping
 * - Symbol extraction from nested structures
 * - Price calculation excluding fees
 */
export class CoinbaseProcessor extends BaseProcessor<UniversalTransaction> {
  constructor() {
    super('coinbase');
  }

  private processSingle(rawData: StoredRawData<UniversalTransaction>): Result<UniversalTransaction | null, string> {
    const transaction = rawData.rawData;

    // The CoinbaseCCXTAdapter already provides transactions in UniversalTransaction format
    // We mainly need to validate and potentially enhance the data

    if (!transaction.id || !transaction.type || !transaction.amount) {
      return err(`Invalid transaction data: missing required fields for transaction ${transaction.id || 'unknown'}`);
    }

    // Validate transaction type
    const validTypes = ['trade', 'deposit', 'withdrawal', 'transfer', 'fee', 'income', 'other'];
    if (!validTypes.includes(transaction.type)) {
      return err(`Invalid transaction type: ${transaction.type} for transaction ${transaction.id}`);
    }

    // Ensure the transaction has proper metadata
    const processedTransaction: UniversalTransaction = {
      ...transaction,
      metadata: {
        ...transaction.metadata,
        processedBy: 'CoinbaseProcessor',
        processingTimestamp: Date.now(),
      },
      network: 'exchange',
      source: 'coinbase',
    };

    return ok(processedTransaction);
  }

  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'exchange';
  }

  protected async processInternal(
    rawDataItems: StoredRawData<UniversalTransaction>[]
  ): Promise<Result<UniversalTransaction[], string>> {
    const transactions: UniversalTransaction[] = [];

    for (const item of rawDataItems) {
      const result = this.processSingle(item);
      if (result.isErr()) {
        this.logger.warn(`Failed to process Coinbase transaction ${item.rawData.id}: ${result.error}`);
        continue;
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return ok(transactions);
  }
}

import type { RawData } from '@exitbook/data';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

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
export class CoinbaseProcessor extends BaseTransactionProcessor {
  constructor() {
    super('coinbase');
  }

  protected async processNormalizedInternal(rawDataItems: RawData[]): Promise<Result<UniversalTransaction[], string>> {
    const transactions: UniversalTransaction[] = [];

    for (const item of rawDataItems) {
      const result = this.processSingle(item);
      if (result.isErr()) {
        this.logger.warn(
          `Failed to process Coinbase transaction ${(item.raw_data as UniversalTransaction).id}: ${result.error}`
        );
        continue;
      }

      const transaction = result.value;
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return Promise.resolve(ok(transactions));
  }

  private processSingle(rawData: RawData): Result<UniversalTransaction | undefined, string> {
    const transaction = rawData.raw_data as UniversalTransaction;

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
}

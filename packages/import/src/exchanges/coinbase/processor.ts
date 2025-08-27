import type { UniversalTransaction } from '@crypto/core';

import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { StoredRawData } from '../../shared/processors/interfaces.ts';

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

  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'exchange';
  }

  async process(rawDataItems: StoredRawData<UniversalTransaction>[]): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${rawDataItems.length} Coinbase transactions`);

    const transactions: UniversalTransaction[] = [];

    for (const item of rawDataItems) {
      try {
        const transaction = await this.processSingle(item);
        if (transaction) {
          transactions.push(transaction);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to process Coinbase transaction ${item.rawData.id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
        // Continue processing other transactions
        continue;
      }
    }

    this.logger.info(`Successfully processed ${transactions.length} Coinbase transactions`);
    return transactions;
  }

  async processSingle(rawData: StoredRawData<UniversalTransaction>): Promise<UniversalTransaction | null> {
    const transaction = rawData.rawData;

    try {
      // The CoinbaseCCXTAdapter already provides transactions in UniversalTransaction format
      // We mainly need to validate and potentially enhance the data

      if (!transaction.id || !transaction.type || !transaction.amount) {
        this.logger.warn(
          `Invalid transaction data: missing required fields for transaction ${transaction.id || 'unknown'}`
        );
        return null;
      }

      // Validate transaction type
      const validTypes = ['trade', 'deposit', 'withdrawal', 'transfer', 'fee', 'income', 'other'];
      if (!validTypes.includes(transaction.type)) {
        this.logger.warn(`Invalid transaction type: ${transaction.type} for transaction ${transaction.id}`);
        return null;
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

      // Additional validation for trade transactions
      if (transaction.type === 'trade') {
        if (!transaction.symbol || !transaction.side) {
          this.logger.warn(
            `Trade transaction missing symbol or side: ${transaction.id}, symbol: ${transaction.symbol}, side: ${transaction.side}`
          );
          // Don't reject, but log the issue
        }
      }

      return processedTransaction;
    } catch (error) {
      this.handleProcessingError(error, rawData, 'single transaction processing');
      return null;
    }
  }
}

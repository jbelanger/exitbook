import type { OperationClassification } from '@exitbook/core';
import type { CoinbaseLedgerEntry } from '@exitbook/exchanges-providers';
import type { Result } from 'neverthrow';

import type { ProcessedTransaction } from '../../../shared/types/processors.js';
import { classifyExchangeOperationFromFundFlow } from '../shared/correlating-exchange-processor-utils.js';
import { CorrelatingExchangeProcessor } from '../shared/correlating-exchange-processor.js';
import { byCorrelationId, coinbaseGrossAmounts, type RawTransactionWithMetadata } from '../shared/strategies/index.js';
import type { ExchangeFundFlow } from '../shared/types.js';

/**
 * Coinbase processor with correlation and gross amount semantics.
 * Fixes production bug where trades weren't being correlated.
 *
 * Uses:
 * - byCorrelationId grouping: Groups related entries (e.g., both sides of swap)
 * - coinbaseGrossAmounts interpretation: Handles Coinbase's unique amount semantics
 *
 * Coinbase specifics:
 * - Swaps create 2 correlated entries (one for each asset)
 * - For withdrawals: amount includes fee (gross), need to subtract for net
 * - For trades/deposits: amount is gross, fee is separate
 * - Fees may be duplicated across correlated entries (deduplication needed)
 * - Interest/staking rewards: Classified as "reward" income, not deposits
 *
 * Uses CoinbaseLedgerEntry generic parameter to provide type-safe access to raw Coinbase data.
 */
export class CoinbaseProcessor extends CorrelatingExchangeProcessor<CoinbaseLedgerEntry> {
  /** Store current entry group for classification (instance state during processing) */
  private currentEntryGroup: RawTransactionWithMetadata<CoinbaseLedgerEntry>[] = [];

  constructor() {
    super('coinbase', byCorrelationId, coinbaseGrossAmounts);
  }

  /**
   * Override to capture entry group for later use in classification.
   */
  protected override selectPrimaryEntry(
    entryGroup: RawTransactionWithMetadata<CoinbaseLedgerEntry>[],
    fundFlow: ExchangeFundFlow
  ): RawTransactionWithMetadata<CoinbaseLedgerEntry> | undefined {
    this.currentEntryGroup = entryGroup;
    return super.selectPrimaryEntry(entryGroup, fundFlow);
  }

  /**
   * Override to handle Coinbase-specific transaction types like "interest" rewards.
   */
  protected override determineOperationFromFundFlow(fundFlow: ExchangeFundFlow): OperationClassification {
    // Check if this is a staking/interest reward by examining raw transaction type
    const primaryEntry = this.currentEntryGroup[0];

    if (primaryEntry?.normalized.type === 'interest') {
      return {
        operation: {
          category: 'staking',
          type: 'reward',
        },
      };
    }

    // Use base classification for all other transaction types
    return classifyExchangeOperationFromFundFlow(fundFlow);
  }

  /**
   * Override to add blockchain metadata when hash is present in Coinbase data.
   */
  protected override async processInternal(normalizedData: unknown[]): Promise<Result<ProcessedTransaction[], string>> {
    // Call parent to get processed transactions
    const result = await super.processInternal(normalizedData);

    if (result.isErr()) {
      return result;
    }

    const transactions = result.value;
    const entries = normalizedData as RawTransactionWithMetadata<CoinbaseLedgerEntry>[];

    // Enhance transactions with blockchain metadata from entries
    const enhanced = transactions.map((tx) => {
      // Find the entry group for this transaction by matching externalId
      const matchingEntry = entries.find((entry) => entry.normalized.id === tx.externalId);

      if (!matchingEntry?.normalized.hash) {
        return tx;
      }

      // Extract blockchain metadata from normalized exchange data
      const { hash, network } = matchingEntry.normalized;

      // Add blockchain field when hash is present
      // Use "unknown" for blockchain name since we can't reliably determine it from exchange data
      // The transaction_hash is what matters for linking
      return {
        ...tx,
        blockchain:
          hash && hash.trim() !== ''
            ? {
                name: network || 'unknown',
                transaction_hash: hash.trim(),
                is_confirmed: tx.status === 'success',
              }
            : undefined,
      };
    });

    return result.map(() => enhanced);
  }
}

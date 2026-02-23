import type { NormalizedTransactionBase, TransactionWithRawData } from '@exitbook/blockchain-providers';
import type { RawTransactionInput } from '@exitbook/core';

/**
 * Maps provider batch transactions to raw transaction format for database storage.
 * Pure function - no side effects, testable in isolation.
 *
 * The eventId is pre-computed by the provider during normalization, eliminating
 * the need for downstream code to understand provider-specific deduplication logic.
 *
 * @param transactions - Array of transactions with raw data from provider
 * @param providerName - Name of the provider that fetched the data
 * @param sourceAddress - Address being imported
 * @param transactionTypeHint - Optional type hint for processor correlation (chain-specific)
 * @returns Array of raw transactions ready for database storage
 */
export function mapToRawTransactions<T extends NormalizedTransactionBase & { timestamp: number }>(
  transactions: TransactionWithRawData<T>[],
  providerName: string,
  sourceAddress: string,
  transactionTypeHint?: string
): RawTransactionInput[] {
  return transactions.map((txWithRaw) => ({
    eventId: txWithRaw.normalized.eventId,
    blockchainTransactionHash: txWithRaw.normalized.id,
    timestamp: txWithRaw.normalized.timestamp,
    normalizedData: txWithRaw.normalized,
    providerName,
    providerData: txWithRaw.raw,
    sourceAddress,
    ...(transactionTypeHint !== undefined && { transactionTypeHint }),
  }));
}

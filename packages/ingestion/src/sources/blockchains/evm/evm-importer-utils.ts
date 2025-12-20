import type { EvmTransaction, TransactionWithRawData } from '@exitbook/blockchain-providers';
import type { RawTransactionInput } from '@exitbook/core';

/**
 * Maps EvmTransaction.type to transactionTypeHint for database storage
 */
function mapTransactionTypeToHint(type: EvmTransaction['type']): 'normal' | 'internal' | 'token' | 'beacon_withdrawal' {
  switch (type) {
    case 'internal':
      return 'internal';
    case 'token_transfer':
      return 'token';
    case 'beacon_withdrawal':
      return 'beacon_withdrawal';
    case 'transfer':
    case 'contract_call':
    default:
      return 'normal';
  }
}

/**
 * Map provider transactions to raw transaction format for database storage.
 * Pure function - no side effects, testable in isolation.
 *
 * The eventId is pre-computed by the provider during normalization, eliminating
 * the need for downstream code to understand provider-specific deduplication logic.
 * Each provider computes eventId using chain-appropriate discriminating fields
 * (logIndex, traceId, output index, etc.) to ensure unique identification of
 * events within a transaction.
 *
 * @param transactions - Array of transactions with raw data from provider
 * @param providerName - Name of the provider that fetched the data
 * @param sourceAddress - Address being imported
 * @param transactionTypeHint - Type of transaction (normal, internal, token) - only used as fallback
 * @returns Array of raw transactions ready for database storage
 */
export function mapToRawTransactions(
  transactions: TransactionWithRawData<EvmTransaction>[],
  providerName: string,
  sourceAddress: string,
  _transactionTypeHint: 'normal' | 'internal' | 'token' | 'beacon_withdrawal'
): RawTransactionInput[] {
  return transactions.map((txWithRaw) => ({
    providerName,
    eventId: txWithRaw.normalized.eventId,
    blockchainTransactionHash: txWithRaw.normalized.id,
    // Use the actual transaction type instead of the blanket hint
    // This ensures internal transactions from Moralis (which includes them in the normal stream)
    // are correctly tagged as 'internal' instead of 'normal'
    transactionTypeHint: mapTransactionTypeToHint(txWithRaw.normalized.type),
    sourceAddress,
    normalizedData: txWithRaw.normalized,
    providerData: txWithRaw.raw,
  }));
}

import type { EvmTransaction, TransactionWithRawData } from '@exitbook/blockchain-providers';
import { generateUniqueTransactionId } from '@exitbook/blockchain-providers';
import type { RawTransactionInput } from '@exitbook/core';

/**
 * Map provider transactions to external transaction format
 * Pure function - no side effects, testable in isolation
 *
 * @param transactions - Array of transactions with raw data from provider
 * @param providerName - Name of the provider that fetched the data
 * @param sourceAddress - Address being imported
 * @param transactionTypeHint - Type of transaction (normal, internal, token)
 * @returns Array of raw transactions ready for database storage
 */
export function mapToRawTransactions(
  transactions: TransactionWithRawData<EvmTransaction>[],
  providerName: string,
  sourceAddress: string,
  transactionTypeHint: 'normal' | 'internal' | 'token'
): RawTransactionInput[] {
  return transactions.map((txWithRaw) => ({
    providerName,
    externalId: generateUniqueTransactionId(txWithRaw.normalized),
    blockchainTransactionHash: txWithRaw.normalized.id,
    transactionTypeHint,
    sourceAddress,
    normalizedData: txWithRaw.normalized,
    rawData: txWithRaw.raw,
  }));
}

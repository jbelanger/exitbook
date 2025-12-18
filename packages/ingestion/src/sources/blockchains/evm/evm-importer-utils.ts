import type { EvmTransaction, TransactionWithRawData } from '@exitbook/blockchain-providers';
import { generateUniqueTransactionEventId } from '@exitbook/blockchain-providers';
import type { RawTransactionInput } from '@exitbook/core';

/**
 * Map provider transactions to external transaction format
 * Pure function - no side effects, testable in isolation
 *
 * EVM-Specific Deduplication Limitations:
 * - logIndex: Only provided by Moralis (not Routescan/Alchemy). Cannot be used for
 *   deduplication across providers. Multiple token transfers in the same transaction
 *   with identical parameters will be treated as duplicates.
 *
 * - traceId: Only provided by Routescan (not Alchemy/Moralis). Cannot be used for
 *   deduplication across providers. Multiple internal transactions in the same
 *   transaction with identical parameters will be treated as duplicates.
 *
 * These fields are excluded from eventId generation to ensure deterministic IDs
 * across all EVM providers. Other blockchains may include these fields if all
 * their providers consistently supply them.
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
    eventId: generateUniqueTransactionEventId({
      amount: txWithRaw.normalized.amount,
      currency: txWithRaw.normalized.currency,
      from: txWithRaw.normalized.from,
      id: txWithRaw.normalized.id,
      timestamp: txWithRaw.normalized.timestamp,
      to: txWithRaw.normalized.to,
      tokenAddress: txWithRaw.normalized.tokenAddress,
      // Note: traceId and logIndex intentionally excluded (see function docs)
      type: txWithRaw.normalized.type,
    }),
    blockchainTransactionHash: txWithRaw.normalized.id,
    transactionTypeHint,
    sourceAddress,
    normalizedData: txWithRaw.normalized,
    providerData: txWithRaw.raw,
  }));
}

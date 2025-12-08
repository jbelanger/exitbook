import type { CursorState, RawTransactionInput } from '@exitbook/core';
import type { Result } from 'neverthrow';

/**
 * Parameters for fetching exchange data
 */
export interface FetchParams {
  cursor?: Record<string, CursorState> | undefined;
}

/**
 * Generic exchange credentials type
 * Each exchange validates its own required fields via Zod schemas
 */
export type ExchangeCredentials = Record<string, string>;

/**
 * Exchange cursor for tracking progress per operation type.
 * Each operation type (trade, deposit, withdrawal, order) maintains its own timestamp.
 */
export type ExchangeCursor = Record<string, number>;

/**
 * Balance snapshot from exchange
 * Maps currency symbol to total balance as decimal string
 */
export interface BalanceSnapshot {
  balances: Record<string, string>;
  timestamp: number;
}

/**
 * Result of fetching transaction data from exchange
 */
export interface FetchTransactionDataResult {
  transactions: RawTransactionInput[];
  cursorUpdates: Record<string, CursorState>;
}

/**
 * Single batch of transactions from streaming fetch
 */
export interface FetchBatchResult {
  // Transactions in this batch
  transactions: RawTransactionInput[];
  // Operation type (e.g., "ledger", "trade", "deposit")
  operationType: string;
  // Cursor state for this operation type
  cursor: CursorState;
  // Whether this operation type has completed (no more batches)
  isComplete: boolean;
}

/**
 * Base interface for exchange clients
 */
export interface IExchangeClient {
  readonly exchangeId: string;

  /**
   * Stream transaction data in batches for memory-bounded processing
   * Yields batches as they're fetched, enabling incremental persistence and crash recovery
   * Optional - exchanges can implement this for improved performance
   */
  fetchTransactionDataStreaming(params?: FetchParams): AsyncIterableIterator<Result<FetchBatchResult, Error>>;

  /**
   * Fetch current total balance for all currencies
   */
  fetchBalance(): Promise<Result<BalanceSnapshot, Error>>;
}

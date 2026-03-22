import type { CursorState, Result } from '@exitbook/foundation';

import type { ExchangeClientTransaction } from './raw-transaction.js';

export { ExchangeClientCredentialsSchema, type ExchangeClientCredentials } from './exchange-credentials.js';
export { ExchangeClientTransactionSchema, type ExchangeClientTransaction } from './raw-transaction.js';

/**
 * Parameters for fetching exchange data
 */
export interface ExchangeClientFetchParams {
  cursor?: Record<string, CursorState> | undefined;
}

/**
 * Balance snapshot from exchange
 * Maps currency symbol to total balance as decimal string
 */
export interface ExchangeBalanceSnapshot {
  balances: Record<string, string>;
  timestamp: number;
}

/**
 * Single batch of transactions from streaming fetch
 */
export interface ExchangeClientTransactionBatch {
  // Transactions in this batch
  transactions: ExchangeClientTransaction[];
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
  fetchTransactionDataStreaming(
    params?: ExchangeClientFetchParams
  ): AsyncIterableIterator<Result<ExchangeClientTransactionBatch, Error>>;

  /**
   * Fetch current total balance for all currencies
   */
  fetchBalance(): Promise<Result<ExchangeBalanceSnapshot, Error>>;
}

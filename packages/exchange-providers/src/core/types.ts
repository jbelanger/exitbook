import type { CursorState, ExternalTransaction } from '@exitbook/core';
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
  transactions: ExternalTransaction[];
  cursorUpdates: Record<string, CursorState>;
}

/**
 * Base interface for exchange clients
 */
export interface IExchangeClient {
  readonly exchangeId: string;

  /**
   * Fetch all transaction data (trades, deposits, withdrawals, orders, etc.)
   * Validates data and returns transactions ready for storage along with cursor updates.
   * May return partial results via PartialImportError if validation fails partway through.
   */
  fetchTransactionData(params?: FetchParams): Promise<Result<FetchTransactionDataResult, Error>>;

  /**
   * Fetch current total balance for all currencies
   */
  fetchBalance(): Promise<Result<BalanceSnapshot, Error>>;
}

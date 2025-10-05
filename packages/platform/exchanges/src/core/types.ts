import type { Result } from 'neverthrow';

/**
 * Generic raw data response from exchange APIs
 */
export interface RawExchangeData<T = unknown> {
  data: T;
}

/**
 * Parameters for fetching exchange data
 */
export interface FetchParams {
  since?: number | undefined;
  until?: number | undefined;
  limit?: number | undefined;
}

/**
 * Base interface for exchange clients
 */
export interface IExchangeClient {
  readonly exchangeId: string;

  /**
   * Fetch all transaction data (trades, deposits, withdrawals, orders, etc.)
   */
  fetchTransactionData(params?: FetchParams): Promise<Result<RawExchangeData[], Error>>;
}

import type { Result } from 'neverthrow';

/**
 * Transaction with metadata ready for storage
 */
export interface RawTransactionWithMetadata {
  cursor?: Record<string, number> | undefined;
  externalId?: string | undefined;
  metadata: {
    [key: string]: unknown;
    providerId: string;
    source?: string | undefined;
  };
  rawData: unknown;
}

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
  cursor?: Record<string, number> | undefined;
}

/**
 * Base interface for exchange clients
 */
export interface IExchangeClient {
  readonly exchangeId: string;

  /**
   * Fetch all transaction data (trades, deposits, withdrawals, orders, etc.)
   * Validates data and returns transactions ready for storage.
   * May return partial results via PartialImportError if validation fails partway through.
   */
  fetchTransactionData(params?: FetchParams): Promise<Result<RawTransactionWithMetadata[], Error>>;
}

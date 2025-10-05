import type { Result } from 'neverthrow';

/**
 * Transaction with metadata ready for storage
 */
export interface RawTransactionWithMetadata {
  externalId?: string | undefined;
  metadata: {
    [key: string]: unknown;
    providerId: string;
    source?: string | undefined;
  };
  rawData: unknown;
  timestamp?: Date | undefined;
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
  limit?: number | undefined;
  since?: number | undefined;
  until?: number | undefined;
}

/**
 * Base interface for exchange clients
 * @template TParsedData - The parsed and validated transaction data type (should be a discriminated union)
 */
export interface IExchangeClient<TParsedData = unknown> {
  readonly exchangeId: string;

  /**
   * Fetch all transaction data (trades, deposits, withdrawals, orders, etc.)
   * Validates data and returns transactions ready for storage.
   * May return partial results via PartialImportError if validation fails partway through.
   */
  fetchTransactionData(params?: FetchParams): Promise<Result<RawTransactionWithMetadata[], Error>>;

  /**
   * Validate and parse raw exchange data
   * @param rawData - Untyped data from API
   * @returns Result with parsed data or validation error
   */
  validate(rawData: unknown): Result<TParsedData, Error>;
}

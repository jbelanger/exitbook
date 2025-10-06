import type { Result } from 'neverthrow';

/**
 * Transaction with metadata ready for storage
 */
export interface RawTransactionWithMetadata {
  cursor?: Record<string, number> | undefined;
  externalId?: string | undefined;
  rawData: unknown;
}

/**
 * Parameters for fetching exchange data
 */
export interface FetchParams {
  cursor?: Record<string, number> | undefined;
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

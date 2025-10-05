/**
 * @exitbook/exchanges
 *
 * Exchange provider integrations using ccxt for raw data fetching.
 * ccxt is used only for HTTP client connectivity, not for parsed data.
 */

// Core types
export type { ExchangeCredentials } from './types/credentials.ts';
export type {
  IExchangeClient,
  FetchParams,
  RawExchangeData,
  RawTransactionWithMetadata as ExchangeRawTransaction,
} from './core/types.ts';
export { PartialImportError as PartialValidationError } from './core/errors.ts';

// Kraken
export { KrakenClient } from './kraken/client.ts';
export * from './kraken/schemas.ts';

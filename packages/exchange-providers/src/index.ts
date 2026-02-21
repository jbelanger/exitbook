/**
 * @exitbook/exchange-providers
 *
 * Exchange provider integrations using ccxt for raw data fetching.
 * ccxt is used only for HTTP client connectivity, not for parsed data.
 */

// Core
export { PartialImportError } from './core/errors.js';
export { createExchangeClient } from './core/factory.js';
export { ExchangeLedgerEntrySchema } from './core/schemas.js';
export type { ExchangeLedgerEntry } from './core/schemas.js';
export type { BalanceSnapshot, FetchBatchResult, IExchangeClient } from './core/types.js';

// Coinbase
export { createCoinbaseClient } from './exchanges/coinbase/client.js';
export {
  CoinbaseCredentialsSchema,
  CoinbaseLedgerEntrySchema,
  type CoinbaseCredentials,
  type CoinbaseLedgerEntry,
} from './exchanges/coinbase/schemas.js';

// Kraken
export { createKrakenClient } from './exchanges/kraken/client.js';
export {
  KrakenCredentialsSchema,
  KrakenLedgerEntrySchema,
  type KrakenCredentials,
  type KrakenLedgerEntry,
} from './exchanges/kraken/schemas.js';

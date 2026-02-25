/**
 * @exitbook/exchange-providers
 *
 * Exchange provider integrations for raw data fetching.
 * Each exchange has its own authenticated API client.
 */

// Core
export { createExchangeClient } from './core/factory.js';
export type { BalanceSnapshot, FetchBatchResult, IExchangeClient } from './core/types.js';

// Coinbase
export { createCoinbaseClient } from './exchanges/coinbase/client.js';
export {
  CoinbaseCredentialsSchema,
  RawCoinbaseLedgerEntrySchema,
  type CoinbaseCredentials,
  type RawCoinbaseLedgerEntry,
} from './exchanges/coinbase/schemas.js';

// Kraken
export { createKrakenClient } from './exchanges/kraken/client.js';
export { normalizeKrakenAsset } from './exchanges/kraken/kraken-utils.js';
export {
  KrakenCredentialsSchema,
  KrakenLedgerEntrySchema,
  type KrakenCredentials,
  type KrakenLedgerEntry,
} from './exchanges/kraken/schemas.js';

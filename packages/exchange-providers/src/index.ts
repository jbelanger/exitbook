/**
 * @exitbook/exchange-providers
 *
 * Exchange provider integrations for raw data fetching.
 * Each exchange has its own authenticated API client.
 */

export { createExchangeClient } from './runtime/client-factory.js';
export {
  ExchangeCredentialsSchema,
  RawTransactionInputSchema,
  type BalanceSnapshot,
  type ExchangeCredentials,
  type FetchBatchResult,
  type IExchangeClient,
  type RawTransactionInput,
} from './contracts/index.js';

export {
  createCoinbaseClient,
  CoinbaseCredentialsSchema,
  RawCoinbaseLedgerEntrySchema,
  type CoinbaseCredentials,
  type RawCoinbaseLedgerEntry,
} from './exchanges/coinbase/index.js';

export {
  createKrakenClient,
  KrakenCredentialsSchema,
  KrakenLedgerEntrySchema,
  normalizeKrakenAsset,
  type KrakenCredentials,
  type KrakenLedgerEntry,
} from './exchanges/kraken/index.js';

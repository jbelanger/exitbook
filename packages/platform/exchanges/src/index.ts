/**
 * @exitbook/exchanges
 *
 * Exchange provider integrations using ccxt for raw data fetching.
 * ccxt is used only for HTTP client connectivity, not for parsed data.
 */

// Core
export { PartialImportError } from './core/errors.ts';
export type { ExchangeCredentials } from './core/types.ts';

// Coinbase
export { createCoinbaseClient, type CoinbaseLedgerEntry } from './coinbase/client.ts';

// Kraken
export { createKrakenClient, type KrakenLedgerEntry } from './kraken/client.ts';

// KuCoin
export { createKuCoinClient, type KuCoinLedgerEntry } from './kucoin/client.ts';

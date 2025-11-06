/**
 * @exitbook/exchanges
 *
 * Exchange provider integrations using ccxt for raw data fetching.
 * ccxt is used only for HTTP client connectivity, not for parsed data.
 */

// Core
export { PartialImportError } from './core/errors.js';
export { createExchangeClient } from './core/factory.js';
export { ExchangeLedgerEntrySchema } from './core/schemas.js';
export type { ExchangeLedgerEntry } from './core/schemas.js';
export type { BalanceSnapshot, ExchangeCredentials, IExchangeClient } from './core/types.js';

// Coinbase
export { createCoinbaseClient } from './coinbase/client.js';
export { CoinbaseLedgerEntrySchema } from './coinbase/schemas.js';
export type { CoinbaseLedgerEntry } from './coinbase/client.js';

// Kraken
export { createKrakenClient } from './kraken/client.js';

// KuCoin
export { createKuCoinClient } from './kucoin/client.js';

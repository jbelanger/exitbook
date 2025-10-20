/**
 * @exitbook/exchanges
 *
 * Exchange provider integrations using ccxt for raw data fetching.
 * ccxt is used only for HTTP client connectivity, not for parsed data.
 */

// Core
export { PartialImportError } from './core/errors.ts';
export { createExchangeClient } from './core/factory.ts';
export { ExchangeLedgerEntrySchema } from './core/schemas.ts';
export type { ExchangeLedgerEntry } from './core/schemas.ts';
export type { BalanceSnapshot, ExchangeCredentials, IExchangeClient } from './core/types.ts';

// Coinbase
export { createCoinbaseClient } from './coinbase/client.ts';
export { CoinbaseLedgerEntrySchema } from './coinbase/schemas.ts';
export type { CoinbaseLedgerEntry } from './coinbase/client.ts';

// Kraken
export { createKrakenClient } from './kraken/client.ts';

// KuCoin
export { createKuCoinClient } from './kucoin/client.ts';

/**
 * @exitbook/exchanges
 *
 * Exchange provider integrations using ccxt for raw data fetching.
 * ccxt is used only for HTTP client connectivity, not for parsed data.
 */

// Core
export { PartialImportError } from './core/errors.ts';
export type { ExchangeCredentials } from './core/types.ts';

// Kraken
export { createKrakenClient, type KrakenLedgerEntry } from './kraken/client.ts';

/**
 * @exitbook/exchanges
 *
 * Exchange provider integrations using ccxt for raw data fetching.
 * ccxt is used only for HTTP client connectivity, not for parsed data.
 */

// Core types
export type { ExchangeCredentials } from './types/credentials.ts';
export type { IExchangeClient, FetchParams, RawExchangeData } from './core/types.ts';

// Kraken
export { KrakenClient } from './kraken/client.ts';
export * from './kraken/schemas.ts';

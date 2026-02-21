import type { Currency } from '@exitbook/core';
import type { IProvider } from '@exitbook/resilience/provider-health';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';

/**
 * Query for fetching price data
 */
/** Max recursion depth for stablecoin conversion (fetchPrice → stablecoin rate lookup) */
export const MAX_PRICE_QUERY_DEPTH = 1;

export interface PriceQuery {
  /** Asset symbol (e.g., 'BTC', 'ETH') */
  assetSymbol: Currency;
  /** Timestamp for price lookup */
  timestamp: Date;
  /** Target currency (default: 'USD') */
  currency: Currency;
  /** @internal Recursion depth for stablecoin conversion */
  _depth?: number | undefined;
}

/**
 * Historical data granularity levels for provider capabilities
 * These represent the precision of historical data that a provider can supply
 */
export type HistoricalGranularity = 'minute' | 'hour' | 'day';

/**
 * Price data granularity levels
 * - exact: Precise price at exact timestamp (manual entry, trade execution)
 * - minute: Minute-level aggregated data
 * - hour: Hourly aggregated data
 * - day: Daily aggregated data (typically midnight UTC)
 */
export type PriceGranularity = 'exact' | HistoricalGranularity;

/**
 * Normalized price data from any provider
 */
export interface PriceData {
  assetSymbol: Currency;
  timestamp: Date;
  price: Decimal;
  /**
   * Currency denomination of the price
   *
   * Always USD
   *
   * BasePriceProvider automatically converts stablecoin-denominated prices
   * (USDT, USDC, etc.) to USD to capture de-peg events. Providers may fetch
   * prices in stablecoin pairs internally, but the returned data is always
   * normalized to USD.
   */
  currency: Currency;
  source: string; // Provider name
  fetchedAt: Date;
  /** Granularity of the price data - indicates precision of timestamp */
  granularity?: PriceGranularity | undefined;
}

/**
 * Provider operation types
 */
export type PriceProviderOperation = 'fetchPrice' | 'fetchHistoricalRange';

/**
 * Rate limit information for a provider
 */
export interface ProviderRateLimit {
  /** Maximum burst requests allowed */
  burstLimit: number;
  /** Requests per hour limit */
  requestsPerHour: number;
  /** Requests per minute limit */
  requestsPerMinute: number;
  /** Requests per second limit */
  requestsPerSecond: number;
}

/**
 * Granularity support configuration for a provider
 * Defines what historical data granularity levels are available and for how long
 */
export interface GranularitySupport {
  /** Granularity level for historical data (minute, hour, day) */
  granularity: HistoricalGranularity;
  /** Maximum days back this granularity is available (undefined = unlimited) */
  maxHistoryDays: number | undefined;
  /** Description of the limitation (e.g., "Free tier limit", "API restriction") */
  limitation?: string | undefined;
}

/**
 * Asset types that providers can support
 */
export type AssetType = 'crypto' | 'fiat';

/**
 * Provider capabilities metadata
 */
export interface ProviderCapabilities {
  /** Operations supported by this provider */
  supportedOperations: PriceProviderOperation[];

  /** Asset types this provider supports (crypto, fiat, or both) */
  supportedAssetTypes: AssetType[];

  /**
   * Specific assets this provider can price (SOURCE assets in query)
   *
   * If undefined/empty: Provider supports ALL assets of the declared supportedAssetTypes
   * If specified: Provider only supports these specific assets
   *
   * Note: All providers return prices denominated in USD
   *
   * Examples:
   * - AlphaVantage: undefined = supports all fiat currencies
   * - ECB: ['EUR', 'GBP', 'JPY', ...] = supports ~30 European/major currencies
   * - Bank of Canada: ['CAD'] = only Canadian dollar
   * - CoinGecko: undefined = synced from API, supports top 5000+ coins
   *
   * For query { assetSymbol: 'EUR', currency: 'USD', timestamp: ... }:
   * - supportedAssetTypes must include 'fiat'
   * - supportedAssets must include 'EUR' (or be undefined for universal provider)
   */
  supportedAssets?: string[] | undefined;

  /** Rate limit configuration */
  rateLimit: ProviderRateLimit;

  /** Granularity support - defines what historical data precision is available */
  granularitySupport?: GranularitySupport[] | undefined;
}

/**
 * Provider metadata for registration
 */
export interface ProviderMetadata {
  name: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  requiresApiKey: boolean;
}

/**
 * Provider health tracking (re-exported from shared resilience package)
 */
export type { IProvider, ProviderHealth, ProviderHealthWithCircuit } from '@exitbook/resilience/provider-health';

/**
 * Core interface that all price providers must implement
 */
export interface IPriceProvider extends IProvider {
  /**
   * Fetch price for a single asset at a specific timestamp
   */
  fetchPrice(query: PriceQuery): Promise<Result<PriceData, Error>>;

  /**
   * Get provider metadata
   */
  getMetadata(): ProviderMetadata;

  /**
   * Optional initialization hook called after provider creation
   * Used for setup tasks like syncing coin lists, warming caches, etc.
   */
  initialize?(): Promise<Result<void, Error>>;

  /**
   * Cleanup resources (HTTP clients, timers, etc.)
   */
  destroy(): Promise<void>;
}

/**
 * Configuration for provider manager
 */
export interface ProviderManagerConfig {
  /** Default currency for queries */
  defaultCurrency: string;
  /** Circuit breaker threshold */
  maxConsecutiveFailures: number;
  /** Cache TTL in seconds */
  cacheTtlSeconds: number;
}

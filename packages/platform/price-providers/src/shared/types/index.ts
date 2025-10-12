import type { Currency } from '@exitbook/core';
import type { Result } from 'neverthrow';

/**
 * Query for fetching price data
 */
export interface PriceQuery {
  /** Asset symbol (e.g., 'BTC', 'ETH') */
  asset: Currency;
  /** Timestamp for price lookup */
  timestamp: Date;
  /** Target currency (default: 'USD') */
  currency: Currency;
}

/**
 * Price data granularity levels
 */
export type PriceGranularity = 'minute' | 'hour' | 'day';

/**
 * Normalized price data from any provider
 */
export interface PriceData {
  asset: Currency;
  timestamp: Date;
  price: number;
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
  /** Granularity level (minute, hour, day) */
  granularity: PriceGranularity;
  /** Maximum days back this granularity is available (undefined = unlimited) */
  maxHistoryDays: number | undefined;
  /** Description of the limitation (e.g., "Free tier limit", "API restriction") */
  limitation?: string | undefined;
}

/**
 * Provider capabilities metadata
 */
export interface ProviderCapabilities {
  /** Operations supported by this provider */
  supportedOperations: PriceProviderOperation[];
  /** Supported currencies */
  supportedCurrencies: string[];
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
 * Provider health tracking
 */
export interface ProviderHealth {
  isHealthy: boolean;
  consecutiveFailures: number;
  lastChecked: number;
  lastError?: string | undefined;
  averageResponseTime: number;
  errorRate: number;
}

/**
 * Core interface that all price providers must implement
 */
export interface IPriceProvider {
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

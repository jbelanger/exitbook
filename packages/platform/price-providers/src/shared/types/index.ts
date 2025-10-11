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
  currency?: Currency | undefined;
}

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
}

/**
 * Provider operation types
 */
export type PriceProviderOperation = 'fetchPrice' | 'fetchBatch' | 'fetchHistoricalRange';

/**
 * Provider capabilities metadata
 */
export interface ProviderCapabilities {
  /** Operations supported by this provider */
  supportedOperations: PriceProviderOperation[];
  /** Maximum batch size for fetchBatch */
  maxBatchSize?: number | undefined;
  /** Supported currencies */
  supportedCurrencies: string[];
  /** Rate limit info */
  rateLimit?:
    | {
        per: 'second' | 'minute' | 'hour';
        requests: number;
      }
    | undefined;
}

/**
 * Provider metadata for registration
 */
export interface ProviderMetadata {
  name: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  priority: number; // Lower = higher priority
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
   * Fetch prices for multiple queries in batch
   */
  fetchBatch(queries: PriceQuery[]): Promise<Result<PriceData[], Error>>;

  /**
   * Get provider metadata
   */
  getMetadata(): ProviderMetadata;
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

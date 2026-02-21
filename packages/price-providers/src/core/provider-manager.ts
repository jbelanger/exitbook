/**
 * Price Provider Manager - orchestrates failover and health tracking
 *
 */

import { isFiat, isStablecoin, type Currency } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { TtlCache } from '@exitbook/resilience/cache';
import { CircuitBreakerRegistry } from '@exitbook/resilience/circuit-breaker';
import { executeWithFailover, type FailoverResult } from '@exitbook/resilience/failover';
import { buildProviderSelectionDebugInfo } from '@exitbook/resilience/provider-selection';
import { ProviderHealthStore } from '@exitbook/resilience/provider-stats';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import { CoinNotFoundError, PriceDataUnavailableError } from './errors.js';
import * as ProviderManagerUtils from './provider-manager-utils.js';
import type {
  IPriceProvider,
  PriceData,
  PriceQuery,
  ProviderHealthWithCircuit,
  ProviderManagerConfig,
} from './types.js';
import { createCacheKey } from './utils.js';

const logger = getLogger('PriceProviderManager');

/**
 * Manages price providers with automatic failover, circuit breakers, and health tracking
 *
 * This is the imperative shell - it manages mutable state and coordinates side effects,
 * but delegates all decision logic to pure functions in provider-manager-utils.js
 */
export class PriceProviderManager {
  private readonly config: ProviderManagerConfig;

  // Mutable state (only place side effects live)
  private providers: IPriceProvider[] = [];
  private readonly healthStore = new ProviderHealthStore();
  private readonly circuitBreakers = new CircuitBreakerRegistry();
  private readonly requestCache: TtlCache;

  constructor(config: Partial<ProviderManagerConfig> = {}) {
    this.config = {
      cacheTtlSeconds: 300, // 5 minutes
      defaultCurrency: 'USD',
      maxConsecutiveFailures: 5,
      ...config,
    };

    this.requestCache = new TtlCache(this.config.cacheTtlSeconds * 1000);
    this.requestCache.startAutoCleanup();
  }

  /**
   * Register providers with the manager
   */
  registerProviders(providers: IPriceProvider[]): void {
    // Sort by priority (pure operation)
    this.providers = providers;

    // Initialize health status and circuit breaker for each provider
    for (const provider of providers) {
      this.healthStore.initializeProvider(provider.name);
      this.circuitBreakers.getOrCreate(provider.name);
    }

    logger.info(`Registered ${providers.length} price providers: ${providers.map((p) => p.name).join(', ')}`);
  }

  /**
   * Fetch price with automatic failover
   */
  async fetchPrice(query: PriceQuery): Promise<Result<FailoverResult<PriceData>, Error>> {
    // Check cache first (uses pure function for key generation)
    const cacheKey = createCacheKey(query, this.config.defaultCurrency);
    const cached = this.requestCache.get<PriceData>(cacheKey);

    if (cached) {
      logger.debug({ assetSymbol: query.assetSymbol, currency: query.currency }, 'Price found in cache');
      return ok({
        data: cached,
        providerName: cached.source,
      });
    }

    // Execute with failover
    const result = await this.runWithFailover(async (provider) => provider.fetchPrice(query), 'fetchPrice', query);

    if (result.isErr()) {
      return result;
    }

    // Cache the result
    this.requestCache.set(cacheKey, result.value.data);

    // Convert stablecoin-denominated prices to USD
    // Skip if we're pricing a stablecoin itself (avoid recursion)
    if (isStablecoin(result.value.data.currency) && !isStablecoin(query.assetSymbol)) {
      return await this.convertStablecoinPriceToUSD(result.value, query.timestamp);
    }

    return result;
  }

  /**
   * Get provider health status (uses pure function for formatting)
   */
  getProviderHealth(): Map<string, ProviderHealthWithCircuit> {
    const result = new Map<string, ProviderHealthWithCircuit>();
    const now = Date.now();

    for (const provider of this.providers) {
      const circuitState = this.circuitBreakers.get(provider.name);
      if (!circuitState) continue;

      const combined = this.healthStore.getProviderHealthWithCircuit(provider.name, circuitState, now);
      if (combined) {
        result.set(provider.name, combined);
      }
    }

    return result;
  }

  /**
   * Reset circuit breaker for a specific provider
   */
  resetCircuitBreaker(providerName: string): void {
    if (this.circuitBreakers.has(providerName)) {
      this.circuitBreakers.reset(providerName);
      logger.info(`Reset circuit breaker for provider: ${providerName}`);
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    // Close all provider HTTP clients
    const closePromises = this.providers.map((provider) =>
      provider.destroy().catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, 'Failed to destroy provider');
      })
    );

    await Promise.all(closePromises);

    this.providers = [];
    this.healthStore.clear();
    this.circuitBreakers.clear();
    this.requestCache.clear();

    logger.debug('PriceProviderManager destroyed');
  }

  /**
   * Execute operation with circuit breaker and failover
   * Delegates to generic executeWithFailover from @exitbook/resilience
   */
  private async runWithFailover<T>(
    operation: (provider: IPriceProvider) => Promise<Result<T, Error>>,
    operationType: string,
    query: PriceQuery
  ): Promise<Result<FailoverResult<T>, Error>> {
    const now = Date.now();
    const assetSymbol = query.assetSymbol;

    // Build health map for selection (providers are keyed by name directly in price context)
    const healthMap = this.healthStore.getHealthMapForKeys(this.providers.map((p) => ({ key: p.name, mapAs: p.name })));

    // Select providers (pure)
    const scoredProviders = ProviderManagerUtils.selectProvidersForOperation(
      this.providers,
      healthMap,
      this.circuitBreakers.asReadonlyMap(),
      operationType,
      now,
      query.timestamp,
      assetSymbol,
      isFiat(assetSymbol)
    );

    // Log selection info
    if (scoredProviders.length > 1) {
      logger.debug(
        `Provider selection for ${operationType} - Providers: ${buildProviderSelectionDebugInfo(scoredProviders)}`
      );
    }

    return executeWithFailover<IPriceProvider, T, Error>({
      providers: scoredProviders.map((sp) => sp.provider),
      execute: operation,
      circuitBreakers: this.circuitBreakers,
      operationLabel: operationType,
      logger,

      isRecoverableError: (error) => error instanceof CoinNotFoundError || error instanceof PriceDataUnavailableError,

      onSuccess: (provider, responseTime) => {
        this.healthStore.updateHealth(provider.name, true, responseTime);
      },

      onFailure: (provider, error, responseTime) => {
        this.healthStore.updateHealth(provider.name, false, responseTime, error.message);
      },

      buildFinalError: (lastError, attemptedProviders, allRecoverable) => {
        const providerNames = attemptedProviders.join(', ');

        if (allRecoverable && lastError) {
          if (lastError instanceof CoinNotFoundError) {
            return new CoinNotFoundError(
              `All ${attemptedProviders.length} provider(s) failed for ${assetSymbol} (tried: ${providerNames})`,
              assetSymbol || 'unknown',
              providerNames
            );
          } else if (lastError instanceof PriceDataUnavailableError) {
            return new PriceDataUnavailableError(
              `All ${attemptedProviders.length} provider(s) failed for ${assetSymbol} (tried: ${providerNames})`,
              assetSymbol || 'unknown',
              providerNames,
              lastError.reason,
              lastError.details
            );
          }
        }

        const errorMsg = assetSymbol
          ? `All ${attemptedProviders.length} provider(s) failed for ${assetSymbol} (tried: ${providerNames})`
          : `All ${attemptedProviders.length} provider(s) failed for ${operationType} (tried: ${providerNames})`;

        return lastError ? new Error(errorMsg) : new Error(`All price providers failed for ${operationType}`);
      },
    });
  }

  /**
   * Convert stablecoin-denominated price to USD
   *
   * When providers return prices in USDT/USDC (e.g., BTC/USDT from Binance),
   * this method fetches the stablecoin's USD price using all available providers
   * and converts accordingly.
   *
   * This captures de-peg events where stablecoins deviate from $1.00.
   *
   * Fallback strategy:
   * 1. Try to fetch historical stablecoin/USD rate from any provider
   * 2. If unavailable, assume 1:1 parity (log warning)
   *
   * @param result - Failover result with stablecoin-denominated price
   * @param timestamp - Original query timestamp
   * @returns Failover result with price converted to USD
   */
  private async convertStablecoinPriceToUSD(
    result: FailoverResult<PriceData>,
    timestamp: Date
  ): Promise<Result<FailoverResult<PriceData>, Error>> {
    const { data: priceData, providerName } = result;
    const stablecoin = priceData.currency;
    const originalSource = priceData.source;

    logger.debug(
      {
        assetSymbol: priceData.assetSymbol,
        stablecoin,
        originalPrice: priceData.price.toFixed(),
        originalProvider: providerName,
      },
      'Converting stablecoin-denominated price to USD'
    );

    // Fetch stablecoin/USD rate using recursive call to fetchPrice
    // This tries ALL providers with automatic failover
    // Safe because we check !query.asset.isStablecoin() before calling this method
    const stablecoinPriceResult = await this.fetchPrice({
      assetSymbol: stablecoin,
      currency: 'USD' as Currency,
      timestamp,
    });

    let conversionRate = priceData.price;
    let conversionSource: string;

    if (stablecoinPriceResult.isOk()) {
      // Successfully fetched stablecoin rate - use it for conversion
      conversionRate = priceData.price.times(stablecoinPriceResult.value.data.price);
      conversionSource = `${originalSource}+${stablecoin.toLowerCase()}-rate`;

      logger.debug(
        {
          stablecoin,
          stablecoinRate: stablecoinPriceResult.value.data.price.toFixed(),
          stablecoinProvider: stablecoinPriceResult.value.providerName,
          convertedPrice: conversionRate.toFixed(),
        },
        'Applied stablecoin conversion rate'
      );
    } else {
      // Failed to fetch stablecoin rate - assume 1:1 parity
      logger.warn(
        {
          stablecoin,
          assetSymbol: priceData.assetSymbol,
          error: stablecoinPriceResult.error.message,
        },
        'Failed to fetch stablecoin rate, assuming 1:1 parity with USD'
      );
      // conversionRate is already set to priceData.price (1:1 conversion)
      conversionSource = `${originalSource}+assumed-${stablecoin.toLowerCase()}-parity`;
    }

    return ok({
      data: {
        ...priceData,
        price: conversionRate,
        currency: 'USD' as Currency,
        source: conversionSource,
      },
      providerName,
    });
  }
}

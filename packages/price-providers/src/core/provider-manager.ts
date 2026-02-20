/**
 * Price Provider Manager - orchestrates failover and health tracking
 *
 */

import { Currency } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { CircuitBreakerRegistry } from '@exitbook/resilience/circuit-breaker';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { CoinNotFoundError, PriceDataUnavailableError } from './errors.js';
import * as ProviderManagerUtils from './provider-manager-utils.js';
import type { IPriceProvider, PriceData, PriceQuery, ProviderHealth, ProviderManagerConfig } from './types.js';
import { createCacheKey } from './utils.js';

const logger = getLogger('PriceProviderManager');

interface CacheEntry {
  data: PriceData;
  expiry: number;
}

interface FailoverResult<T> {
  data: T;
  providerName: string;
}

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
  private healthStatus = new Map<string, ProviderHealth>();
  private readonly circuitBreakers = new CircuitBreakerRegistry();
  private requestCache = new Map<string, CacheEntry>();

  private cacheCleanupTimer?: NodeJS.Timeout | undefined;

  constructor(config: Partial<ProviderManagerConfig> = {}) {
    this.config = {
      cacheTtlSeconds: 300, // 5 minutes
      defaultCurrency: 'USD',
      maxConsecutiveFailures: 5,
      ...config,
    };

    // Start cache cleanup
    this.cacheCleanupTimer = setInterval(() => this.cleanupCache(), this.config.cacheTtlSeconds * 1000);
  }

  /**
   * Register providers with the manager
   */
  registerProviders(providers: IPriceProvider[]): void {
    // Sort by priority (pure operation)
    this.providers = providers;

    // Initialize health status and circuit breaker for each provider
    for (const provider of providers) {
      const metadata = provider.getMetadata();
      this.healthStatus.set(metadata.name, ProviderManagerUtils.createInitialHealth());
      this.circuitBreakers.getOrCreate(metadata.name);
    }

    logger.info(
      `Registered ${providers.length} price providers: ${providers.map((p) => p.getMetadata().name).join(', ')}`
    );
  }

  /**
   * Fetch price with automatic failover
   */
  async fetchPrice(query: PriceQuery): Promise<Result<FailoverResult<PriceData>, Error>> {
    const now = Date.now();

    // Check cache first (uses pure function for key generation)
    const cacheKey = createCacheKey(query, this.config.defaultCurrency);
    const cached = this.requestCache.get(cacheKey);

    if (cached && ProviderManagerUtils.isCacheValid(cached.expiry, now)) {
      logger.debug({ assetSymbol: query.assetSymbol, currency: query.currency }, 'Price found in cache');
      return ok({
        data: cached.data,
        providerName: cached.data.source,
      });
    }

    // Execute with failover
    const result = await this.executeWithFailover(async (provider) => provider.fetchPrice(query), 'fetchPrice', query);

    if (result.isErr()) {
      return result;
    }

    // Convert stablecoin-denominated prices to USD
    // Skip if we're pricing a stablecoin itself (avoid recursion)
    if (result.value.data.currency.isStablecoin() && !query.assetSymbol.isStablecoin()) {
      return await this.convertStablecoinPriceToUSD(result.value, query.timestamp);
    }

    return result;
  }

  /**
   * Get provider health status (uses pure function for formatting)
   */
  getProviderHealth(): Map<string, ProviderHealth & { circuitState: string }> {
    const result = new Map<string, ProviderHealth & { circuitState: string }>();
    const now = Date.now();

    for (const provider of this.providers) {
      const metadata = provider.getMetadata();
      const health = this.healthStatus.get(metadata.name);
      const circuitState = this.circuitBreakers.get(metadata.name);

      if (health && circuitState) {
        result.set(metadata.name, ProviderManagerUtils.getProviderHealthWithCircuit(health, circuitState, now));
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
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }

    // Close all provider HTTP clients
    const closePromises = this.providers.map((provider) =>
      provider.destroy().catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, 'Failed to destroy provider');
      })
    );

    await Promise.all(closePromises);

    this.providers = [];
    this.healthStatus.clear();
    this.circuitBreakers.clear();
    this.requestCache.clear();

    logger.debug('PriceProviderManager destroyed');
  }

  /**
   * Execute operation with circuit breaker and failover
   * Orchestrates side effects, uses pure functions for decisions
   */
  private async executeWithFailover<T>(
    operation: (provider: IPriceProvider) => Promise<Result<T, Error>>,
    operationType: string,
    queryOrQueries: PriceQuery | PriceQuery[]
  ): Promise<Result<FailoverResult<T>, Error>> {
    const now = Date.now();

    // Extract timestamp and asset info from query for provider selection
    const timestamp = Array.isArray(queryOrQueries) ? undefined : queryOrQueries.timestamp;
    const assetSymbol = Array.isArray(queryOrQueries) ? undefined : queryOrQueries.assetSymbol.toString();
    const isFiat = Array.isArray(queryOrQueries) ? undefined : queryOrQueries.assetSymbol.isFiat();

    // Select providers
    const scoredProviders = ProviderManagerUtils.selectProvidersForOperation(
      this.providers,
      this.healthStatus,
      this.circuitBreakers.asReadonlyMap(),
      operationType,
      now,
      timestamp,
      assetSymbol,
      isFiat
    );

    if (scoredProviders.length === 0) {
      return err(new Error(`No providers available for operation: ${operationType}`));
    }

    // Log selection info (uses pure function for formatting)
    if (scoredProviders.length > 1) {
      const debugInfo = ProviderManagerUtils.buildProviderSelectionDebugInfo(scoredProviders);
      logger.debug(`Provider selection for ${operationType} - Providers: ${debugInfo}`);
    }

    let lastError: Error | undefined;
    let attemptNumber = 0;
    let allErrorsAreRecoverable = true; // CoinNotFoundError or PriceDataUnavailableError

    // Try each provider in order
    for (const { provider, metadata, health } of scoredProviders) {
      attemptNumber++;
      const circuitState = this.circuitBreakers.getOrCreate(metadata.name);

      // Check circuit breaker
      const hasOthers = ProviderManagerUtils.hasAvailableProviders(
        scoredProviders.slice(attemptNumber).map((sp) => sp.provider),
        this.circuitBreakers.asReadonlyMap(),
        now
      );

      const blockReason = ProviderManagerUtils.shouldBlockDueToCircuit(circuitState, hasOthers, now);

      if (blockReason === 'circuit_open') {
        logger.debug(`Skipping provider ${metadata.name} - circuit breaker is open`);
        continue;
      }

      if (blockReason === 'circuit_open_no_alternatives') {
        logger.warn(`Using provider ${metadata.name} despite open circuit breaker - all providers unavailable`);
      }

      if (blockReason === 'circuit_half_open') {
        logger.debug(`Testing provider ${metadata.name} in half-open state`);
      }

      // Execute operation (side effect)
      const startTime = Date.now();
      try {
        const result = await operation(provider);
        const responseTime = Date.now() - startTime;

        if (result.isErr()) {
          throw result.error;
        }

        // Record success - update circuit and health (pure functions produce new state)
        this.circuitBreakers.recordSuccess(metadata.name, Date.now());
        this.healthStatus.set(
          metadata.name,
          ProviderManagerUtils.updateHealthMetrics(health, true, responseTime, Date.now())
        );

        // Log success at debug level (successes are expected, only failures need visibility)
        logger.debug(
          {
            provider: metadata.name,
            assetSymbol: assetSymbol,
            responseTime,
            attemptNumber,
            totalProviders: scoredProviders.length,
          },
          `✓ Provider ${metadata.name} (${attemptNumber}/${scoredProviders.length})`
        );

        // Cache single query results
        if (!Array.isArray(queryOrQueries) && !Array.isArray(result.value)) {
          const cacheKey = createCacheKey(queryOrQueries, this.config.defaultCurrency);
          this.requestCache.set(cacheKey, {
            data: result.value as PriceData,
            expiry: Date.now() + this.config.cacheTtlSeconds * 1000,
          });
        }

        return ok({
          data: result.value,
          providerName: metadata.name,
        });
      } catch (error) {
        lastError = error as Error;
        const responseTime = Date.now() - startTime;

        // Distinguish between recoverable failures and actual failures
        const isRecoverableError =
          lastError instanceof CoinNotFoundError || lastError instanceof PriceDataUnavailableError;
        const isLastProvider = attemptNumber === scoredProviders.length;

        // Track if all errors are recoverable (can prompt user in interactive mode)
        if (!isRecoverableError) {
          allErrorsAreRecoverable = false;
        }

        // Log the outcome of this provider
        logger.info(
          {
            provider: metadata.name,
            assetSymbol: assetSymbol,
            attemptNumber,
            totalProviders: scoredProviders.length,
            errorType: lastError.name,
          },
          `✗ Provider ${metadata.name} (${attemptNumber}/${scoredProviders.length}): ${lastError.message}`
        );

        // If this was the last provider, log a summary
        if (isLastProvider) {
          logger.warn(
            { assetSymbol: assetSymbol, totalProviders: scoredProviders.length },
            `All ${scoredProviders.length} provider(s) failed for ${assetSymbol || 'asset'}`
          );
        }

        // Record failure - update circuit and health (pure functions produce new state)
        // Only count as circuit breaker failure if it's NOT a recoverable error
        if (!isRecoverableError) {
          this.circuitBreakers.recordFailure(metadata.name, Date.now());
        }
        this.healthStatus.set(
          metadata.name,
          ProviderManagerUtils.updateHealthMetrics(health, false, responseTime, Date.now(), lastError.message)
        );

        continue;
      }
    }

    // All providers failed - preserve recoverable error types if all failures were recoverable
    const providerNames = scoredProviders.map((sp) => sp.metadata.name).join(', ');

    if (allErrorsAreRecoverable) {
      if (lastError instanceof CoinNotFoundError) {
        return err(
          new CoinNotFoundError(
            `All ${scoredProviders.length} provider(s) failed for ${assetSymbol || 'asset'} (tried: ${providerNames})`,
            assetSymbol || 'unknown',
            providerNames
          )
        );
      } else if (lastError instanceof PriceDataUnavailableError) {
        return err(
          new PriceDataUnavailableError(
            `All ${scoredProviders.length} provider(s) failed for ${assetSymbol || 'asset'} (tried: ${providerNames})`,
            assetSymbol || 'unknown',
            providerNames,
            lastError.reason,
            lastError.details
          )
        );
      }
    }

    const errorMsg = assetSymbol
      ? `All ${scoredProviders.length} provider(s) failed for ${assetSymbol} (tried: ${providerNames})`
      : `All ${scoredProviders.length} provider(s) failed for ${operationType} (tried: ${providerNames})`;

    return err(lastError ? new Error(errorMsg) : new Error(`All price providers failed for ${operationType}`));
  }

  /**
   * Cleanup expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.requestCache.entries()) {
      if (!ProviderManagerUtils.isCacheValid(entry.expiry, now)) {
        this.requestCache.delete(key);
      }
    }
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
        assetSymbol: priceData.assetSymbol.toString(),
        stablecoin: stablecoin.toString(),
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
      currency: Currency.create('USD'),
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
          stablecoin: stablecoin.toString(),
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
          stablecoin: stablecoin.toString(),
          assetSymbol: priceData.assetSymbol.toString(),
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
        currency: Currency.create('USD'),
        source: conversionSource,
      },
      providerName,
    });
  }
}

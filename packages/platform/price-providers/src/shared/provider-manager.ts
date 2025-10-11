/**
 * Price Provider Manager - orchestrates failover and health tracking
 *
 */

import {
  createInitialCircuitState,
  recordFailure,
  recordSuccess,
  resetCircuit,
  type CircuitState,
} from '@exitbook/platform-http';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import * as ProviderManagerUtils from './provider-manager-utils.js';
import { createCacheKey } from './shared-utils.ts';
import type { IPriceProvider, PriceData, PriceQuery, ProviderHealth, ProviderManagerConfig } from './types/index.js';

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
 * but delegates all decision logic to pure functions in provider-manager-utils.ts
 */
export class PriceProviderManager {
  private readonly config: ProviderManagerConfig;

  // Mutable state (only place side effects live)
  private providers: IPriceProvider[] = [];
  private healthStatus = new Map<string, ProviderHealth>();
  private circuitStates = new Map<string, CircuitState>();
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
    this.providers = providers.sort((a, b) => a.getMetadata().priority - b.getMetadata().priority);

    // Initialize health status and circuit breaker for each provider
    for (const provider of providers) {
      const metadata = provider.getMetadata();
      this.healthStatus.set(metadata.name, ProviderManagerUtils.createInitialHealth());
      this.circuitStates.set(metadata.name, createInitialCircuitState());
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
      logger.debug({ asset: query.asset, currency: query.currency }, 'Price found in cache');
      return ok({
        data: cached.data,
        providerName: cached.data.source,
      });
    }

    // Execute with failover
    return this.executeWithFailover(async (provider) => provider.fetchPrice(query), 'fetchPrice', query);
  }

  /**
   * Fetch batch prices with automatic failover
   */
  async fetchBatch(queries: PriceQuery[]): Promise<Result<FailoverResult<PriceData[]>, Error>> {
    return this.executeWithFailover(async (provider) => provider.fetchBatch(queries), 'fetchBatch', queries);
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
      const circuitState = this.circuitStates.get(metadata.name);

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
    const circuitState = this.circuitStates.get(providerName);
    if (circuitState) {
      this.circuitStates.set(providerName, resetCircuit(circuitState));
      logger.info(`Reset circuit breaker for provider: ${providerName}`);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }

    this.providers = [];
    this.healthStatus.clear();
    this.circuitStates.clear();
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

    // Select providers using pure function
    const scoredProviders = ProviderManagerUtils.selectProvidersForOperation(
      this.providers,
      this.healthStatus,
      this.circuitStates,
      operationType,
      now
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

    // Try each provider in order
    for (const { provider, metadata, health } of scoredProviders) {
      attemptNumber++;
      const circuitState = this.getOrCreateCircuitState(metadata.name);

      // Log provider attempt
      if (attemptNumber === 1) {
        logger.debug(`Using provider ${metadata.name} for ${operationType}`);
      } else {
        logger.info(
          `Switching to provider ${metadata.name} for ${operationType} - Reason: ${attemptNumber === 2 ? 'primary_failed' : 'multiple_failures'}, AttemptNumber: ${attemptNumber}, PreviousError: ${lastError?.message}`
        );
      }

      // Check circuit breaker using pure function
      const hasOthers = ProviderManagerUtils.hasAvailableProviders(
        scoredProviders.slice(attemptNumber).map((sp) => sp.provider),
        this.circuitStates,
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
        this.circuitStates.set(metadata.name, recordSuccess(circuitState, Date.now()));
        this.healthStatus.set(
          metadata.name,
          ProviderManagerUtils.updateHealthMetrics(health, true, responseTime, Date.now())
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

        if (attemptNumber < scoredProviders.length) {
          logger.warn(`Provider ${metadata.name} failed, trying next provider: ${lastError.message}`);
        } else {
          logger.error(`All providers failed for ${operationType}: ${lastError.message}`);
        }

        // Record failure - update circuit and health (pure functions produce new state)
        this.circuitStates.set(metadata.name, recordFailure(circuitState, Date.now()));
        this.healthStatus.set(
          metadata.name,
          ProviderManagerUtils.updateHealthMetrics(health, false, responseTime, Date.now(), lastError.message)
        );

        continue;
      }
    }

    // All providers failed
    return err(
      new Error(`All price providers failed for ${operationType}. Last error: ${lastError?.message || 'Unknown error'}`)
    );
  }

  /**
   * Get or create circuit state for provider
   */
  private getOrCreateCircuitState(providerName: string): CircuitState {
    let circuitState = this.circuitStates.get(providerName);
    if (!circuitState) {
      circuitState = createInitialCircuitState();
      this.circuitStates.set(providerName, circuitState);
    }
    return circuitState;
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
}

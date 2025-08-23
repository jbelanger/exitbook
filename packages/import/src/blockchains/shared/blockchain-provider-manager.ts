import { getLogger } from "@crypto/shared-logger";
import type { ProviderHealth } from "./types.ts";

import type { BlockchainExplorersConfig } from "./explorer-config.ts";

import { CircuitBreaker } from "../../shared/utils/circuit-breaker.ts";
import { ProviderRegistry } from "./registry/provider-registry.ts";
import type {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderOperation,
  ProviderOperationType,
} from "./types.ts";

const logger = getLogger("BlockchainProviderManager");

interface CacheEntry {
  result: unknown;
  expiry: number;
}

export class BlockchainProviderManager {
  private providers = new Map<string, IBlockchainProvider[]>();
  private healthStatus = new Map<string, ProviderHealth>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private requestCache = new Map<string, CacheEntry>();
  private rateLimiters = new Map<
    string,
    { lastRequest: number; tokens: number }
  >(); // Simple token bucket
  private readonly cacheTimeout = 30000; // 30 seconds
  private readonly healthCheckInterval = 60000; // 1 minute
  private healthCheckTimer?: NodeJS.Timeout | undefined;
  private cacheCleanupTimer?: NodeJS.Timeout | undefined;

  constructor(private readonly explorerConfig: BlockchainExplorersConfig) {
    // Start periodic health checks
    this.healthCheckTimer = setInterval(
      () => this.performHealthChecks(),
      this.healthCheckInterval,
    );

    // Start cache cleanup
    this.cacheCleanupTimer = setInterval(
      () => this.cleanupCache(),
      this.cacheTimeout,
    );
  }

  /**
   * Cleanup resources and stop background tasks
   */
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }

    // Clear all caches and state
    this.providers.clear();
    this.healthStatus.clear();
    this.circuitBreakers.clear();
    this.requestCache.clear();
    this.rateLimiters.clear();
  }

  /**
   * Register providers for a specific blockchain
   */
  registerProviders(
    blockchain: string,
    providers: IBlockchainProvider[],
  ): void {
    this.providers.set(blockchain, providers);

    // Initialize health status and circuit breakers for each provider
    for (const provider of providers) {
      this.healthStatus.set(provider.name, {
        isHealthy: true,
        lastChecked: 0,
        consecutiveFailures: 0,
        averageResponseTime: 0,
        errorRate: 0,
        rateLimitEvents: 0,
        rateLimitRate: 0,
        lastRateLimitTime: undefined,
      });

      this.circuitBreakers.set(
        provider.name,
        new CircuitBreaker(provider.name),
      );

      // Initialize rate limiter
      this.rateLimiters.set(provider.name, {
        lastRequest: 0,
        tokens: provider.rateLimit.burstLimit || 1,
      });
    }
  }

  /**
   * Auto-register providers from configuration using the registry
   */
  autoRegisterFromConfig(
    blockchain: string,
    network: string = "mainnet",
  ): IBlockchainProvider[] {
    try {
      const config = this.explorerConfig;
      const blockchainConfig = config[blockchain];

      if (!blockchainConfig) {
        logger.warn(`No configuration found for blockchain: ${blockchain}`);
        return [];
      }

      const enabledExplorers = blockchainConfig.explorers
        .filter((explorer) => explorer.enabled)
        .sort((a, b) => a.priority - b.priority);

      const providers: IBlockchainProvider[] = [];

      for (const explorerConfig of enabledExplorers) {
        try {
          // Check if provider is registered in the registry
          if (!ProviderRegistry.isRegistered(blockchain, explorerConfig.name)) {
            logger.warn(
              `Provider ${explorerConfig.name} not found in registry for ${blockchain}. Skipping.`,
            );
            continue;
          }

          // Get provider metadata from registry
          const metadata = ProviderRegistry.getMetadata(
            blockchain,
            explorerConfig.name,
          );
          if (!metadata) {
            logger.warn(
              `No metadata found for provider ${explorerConfig.name}. Skipping.`,
            );
            continue;
          }

          // Build provider config by merging defaults with overrides
          const networkEndpoints = explorerConfig as unknown as Record<
            string,
            { baseUrl: string }
          >; // Explorer config has dynamic network properties
          const metadataNetworks = metadata.networks as Record<
            string,
            { baseUrl: string; websocketUrl?: string }
          >; // Metadata networks has dynamic properties

          const providerConfig = {
            ...metadata.defaultConfig,
            ...explorerConfig,
            // Set the base URL from the network configuration
            baseUrl:
              networkEndpoints[network]?.baseUrl ||
              metadataNetworks[network]?.baseUrl,
            network,
          };

          // Create provider instance from registry
          const provider = ProviderRegistry.createProvider(
            blockchain,
            explorerConfig.name,
            providerConfig,
          );
          providers.push(provider);

          logger.debug(
            `Successfully created provider ${explorerConfig.name} for ${blockchain} - Priority: ${explorerConfig.priority}, BaseUrl: ${providerConfig.baseUrl}, RequiresApiKey: ${metadata.requiresApiKey}`,
          );
        } catch (error) {
          logger.error(
            `Failed to create provider ${explorerConfig.name} for ${blockchain} - Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Register the providers with this manager
      if (providers.length > 0) {
        this.registerProviders(blockchain, providers);
        logger.debug(
          `Auto-registered ${providers.length} providers for ${blockchain}: ${providers.map((p) => p.name).join(", ")}`,
        );
      }

      return providers;
    } catch (error) {
      logger.error(
        `Failed to auto-register providers for ${blockchain} - Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Execute operation with intelligent failover and caching
   */
  async executeWithFailover<T>(
    blockchain: string,
    operation: ProviderOperation<T>,
  ): Promise<T> {
    // Check cache first
    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation.params);
      const cached = this.requestCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        return cached.result as T;
      }
    }

    // Execute with failover logic
    const result = await this.executeWithCircuitBreaker(blockchain, operation);

    // Cache result if cacheable
    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation.params);
      this.requestCache.set(cacheKey, {
        result,
        expiry: Date.now() + this.cacheTimeout,
      });
    }

    return result;
  }

  /**
   * Execute with circuit breaker protection and automatic failover
   */
  private async executeWithCircuitBreaker<T>(
    blockchain: string,
    operation: ProviderOperation<T>,
  ): Promise<T> {
    const providers = this.getProvidersInOrder(blockchain, operation);

    if (providers.length === 0) {
      throw new Error(
        `No providers available for ${blockchain} operation: ${operation.type}`,
      );
    }

    let lastError: Error | null = null;
    let attemptNumber = 0;

    for (const provider of providers) {
      attemptNumber++;
      const circuitBreaker = this.getOrCreateCircuitBreaker(provider.name);

      // Log provider attempt with reason
      if (attemptNumber === 1) {
        logger.debug(`Using provider ${provider.name} for ${operation.type}`);
      } else {
        logger.info(
          `Switching to provider ${provider.name} for ${operation.type} - Reason: ${attemptNumber === 2 ? "primary_failed" : "multiple_failures"}, AttemptNumber: ${attemptNumber}, PreviousError: ${lastError?.message}`,
        );
      }

      // Skip providers with open circuit breakers (unless all are open)
      if (circuitBreaker.isOpen() && this.hasAvailableProviders(providers)) {
        logger.debug(
          `Skipping provider ${provider.name} - circuit breaker is open`,
        );
        continue;
      }

      // Log when using a provider with open circuit breaker (all providers are failing)
      if (circuitBreaker.isOpen()) {
        logger.warn(
          `Using provider ${provider.name} despite open circuit breaker - all providers unavailable`,
        );
      } else if (circuitBreaker.isHalfOpen()) {
        logger.debug(`Testing provider ${provider.name} in half-open state`);
      }

      // Enforce rate limiting before execution
      const rateLimitDelay = await this.enforceRateLimit(provider);
      if (rateLimitDelay > 0) {
        // Track rate limit event
        this.recordRateLimitEvent(provider.name, rateLimitDelay);

        if (rateLimitDelay > 500) {
          // Only log significant delays
          logger.debug(
            `Rate limited ${provider.name} for ${Math.round(rateLimitDelay)}ms before ${operation.type}`,
          );
        }
      }

      const startTime = Date.now();
      try {
        const result = await provider.execute(operation, {});
        const responseTime = Date.now() - startTime;

        // Record success
        circuitBreaker.recordSuccess();
        this.updateHealthMetrics(provider.name, true, responseTime);

        return result;
      } catch (error) {
        lastError = error as Error;
        const responseTime = Date.now() - startTime;

        // Log error without sensitive params details
        const logData: {
          error: string;
          provider: string;
          operation: string;
          attemptNumber: number;
          willRetry: boolean;
          params?: unknown;
        } = {
          error: error instanceof Error ? error.message : String(error),
          provider: provider.name,
          operation: operation.type,
          attemptNumber,
          willRetry: attemptNumber < providers.length,
        };
        // Only log params for non-sensitive operations
        if (!(operation.params as { address?: string })?.address) {
          logData.params = operation.params;
        }

        if (attemptNumber < providers.length) {
          logger.warn(
            `Provider ${provider.name} failed, trying next provider: ${logData.error}`,
          );
        } else {
          logger.error(
            `All providers failed for ${operation.type}: ${logData.error}`,
          );
        }

        // Record failure
        circuitBreaker.recordFailure();
        this.updateHealthMetrics(
          provider.name,
          false,
          responseTime,
          lastError.message,
        );

        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    throw new Error(
      `All providers failed for ${blockchain} operation: ${operation.type}. Last error: ${lastError?.message}`,
    );
  }

  /**
   * Get providers ordered by preference for the given operation
   */
  private getProvidersInOrder<T>(
    blockchain: string,
    operation: ProviderOperation<T>,
  ): IBlockchainProvider[] {
    const candidates = this.providers.get(blockchain) || [];

    // Filter by capability and health, then sort by score
    const scoredProviders = candidates
      .filter((p) => this.supportsOperation(p.capabilities, operation.type))
      .map((p) => ({
        provider: p,
        score: this.scoreProvider(p),
        health: this.healthStatus.get(p.name)!,
      }))
      .sort((a, b) => b.score - a.score); // Higher score = better

    // Log provider selection details
    if (scoredProviders.length > 1) {
      logger.debug(
        `Provider selection for ${operation.type} - Providers: ${JSON.stringify(
          scoredProviders.map((item) => ({
            name: item.provider.name,
            score: item.score,
            isHealthy: item.health.isHealthy,
            errorRate: Math.round(item.health.errorRate * 100),
            consecutiveFailures: item.health.consecutiveFailures,
            avgResponseTime: Math.round(item.health.averageResponseTime),
            rateLimitPerSec: item.provider.rateLimit.requestsPerSecond,
            rateLimitEvents: item.health.rateLimitEvents,
            rateLimitRate: Math.round(item.health.rateLimitRate * 100),
          })),
        )}`,
      );
    }

    return scoredProviders.map((item) => item.provider);
  }

  /**
   * Check if provider supports the requested operation
   */
  private supportsOperation(
    capabilities: ProviderCapabilities,
    operationType: string,
  ): boolean {
    return capabilities.supportedOperations.includes(
      operationType as ProviderOperationType,
    );
  }

  /**
   * Score a provider based on health, performance, and availability
   */
  private scoreProvider(provider: IBlockchainProvider): number {
    const health = this.healthStatus.get(provider.name);
    const circuitBreaker = this.circuitBreakers.get(provider.name);

    if (!health || !circuitBreaker) {
      return 0;
    }

    let score = 100; // Base score

    // Health penalties
    if (!health.isHealthy) score -= 50;
    if (circuitBreaker.isOpen()) score -= 100; // Severe penalty for open circuit
    if (circuitBreaker.isHalfOpen()) score -= 25; // Moderate penalty for half-open

    // Rate limit penalties - both configured limits and actual rate limiting events
    const rateLimit = provider.rateLimit.requestsPerSecond;
    if (rateLimit <= 0.5)
      score -= 40; // Very restrictive (like mempool.space 0.25/sec)
    else if (rateLimit <= 1.0)
      score -= 20; // Moderately restrictive
    else if (rateLimit >= 3.0) score += 10; // Generous rate limits get bonus

    // Dynamic rate limit penalties based on actual events
    const rateLimitPercentage = health.rateLimitRate * 100;
    if (rateLimitPercentage > 50)
      score -= 60; // Very frequently rate limited (>50% of requests)
    else if (rateLimitPercentage > 25)
      score -= 40; // Frequently rate limited (>25% of requests)
    else if (rateLimitPercentage > 10)
      score -= 20; // Occasionally rate limited (>10% of requests)
    else if (rateLimitPercentage < 1) score += 5; // Rarely rate limited bonus

    // Performance bonuses/penalties
    if (health.averageResponseTime < 1000) score += 20; // Fast response bonus
    if (health.averageResponseTime > 5000) score -= 30; // Slow response penalty

    // Error rate penalties
    score -= health.errorRate * 50; // Up to 50 point penalty for 100% error rate

    // Consecutive failure penalties
    score -= health.consecutiveFailures * 10;

    return Math.max(0, score); // Never go below 0
  }

  /**
   * Get or create circuit breaker for provider
   */
  private getOrCreateCircuitBreaker(providerName: string): CircuitBreaker {
    let circuitBreaker = this.circuitBreakers.get(providerName);
    if (!circuitBreaker) {
      circuitBreaker = new CircuitBreaker(providerName);
      this.circuitBreakers.set(providerName, circuitBreaker);
    }
    return circuitBreaker;
  }

  /**
   * Check if there are available providers (circuit not open)
   */
  private hasAvailableProviders(providers: IBlockchainProvider[]): boolean {
    return providers.some((p) => {
      const circuitBreaker = this.circuitBreakers.get(p.name);
      return !circuitBreaker || !circuitBreaker.isOpen();
    });
  }

  /**
   * Record a rate limit event for scoring purposes
   */
  private recordRateLimitEvent(providerName: string, delayMs: number): void {
    const health = this.healthStatus.get(providerName);
    if (!health) return;

    health.rateLimitEvents++;
    health.lastRateLimitTime = Date.now();

    // Update rate limit rate (exponential moving average)
    // Each request either was rate limited (1) or not (0)
    const rateLimitWeight = 1; // This request was rate limited
    health.rateLimitRate = health.rateLimitRate * 0.9 + rateLimitWeight * 0.1;

    logger.debug(
      `Recorded rate limit event for ${providerName} - TotalEvents: ${health.rateLimitEvents}, RateLimitRate: ${Math.round(health.rateLimitRate * 100)}%, DelayMs: ${delayMs}`,
    );
  }

  /**
   * Update health metrics for a provider
   */
  private updateHealthMetrics(
    providerName: string,
    success: boolean,
    responseTime: number,
    errorMessage?: string,
  ): void {
    const health = this.healthStatus.get(providerName);
    if (!health) return;

    const now = Date.now();

    // Update basic metrics
    health.lastChecked = now;
    health.isHealthy = success;

    // Update response time (exponential moving average)
    if (success) {
      health.averageResponseTime =
        health.averageResponseTime === 0
          ? responseTime
          : health.averageResponseTime * 0.8 + responseTime * 0.2;
    }

    // Update failure tracking
    if (success) {
      health.consecutiveFailures = 0;
    } else {
      health.consecutiveFailures++;
      health.lastError = errorMessage;
    }

    // Update error rate (simplified - could use sliding window)
    const errorWeight = success ? 0 : 1;
    health.errorRate = health.errorRate * 0.9 + errorWeight * 0.1;

    // Update rate limit rate for successful requests (they weren't rate limited)
    if (success) {
      const rateLimitWeight = 0; // This request was not rate limited
      health.rateLimitRate = health.rateLimitRate * 0.9 + rateLimitWeight * 0.1;
    }
  }

  /**
   * Perform periodic health checks on all providers
   */
  private async performHealthChecks(): Promise<void> {
    for (const [, providers] of this.providers.entries()) {
      for (const provider of providers) {
        try {
          const startTime = Date.now();
          const isHealthy = await provider.isHealthy();
          const responseTime = Date.now() - startTime;

          this.updateHealthMetrics(provider.name, isHealthy, responseTime);
        } catch (error) {
          this.updateHealthMetrics(
            provider.name,
            false,
            0,
            error instanceof Error ? error.message : "Health check failed",
          );
        }
      }
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.requestCache.entries()) {
      if (entry.expiry <= now) {
        this.requestCache.delete(key);
      }
    }
  }

  /**
   * Get provider health status for monitoring
   */
  getProviderHealth(
    blockchain?: string,
  ): Map<string, ProviderHealth & { circuitState: string }> {
    const result = new Map<string, ProviderHealth & { circuitState: string }>();

    const providersToCheck = blockchain
      ? this.providers.get(blockchain) || []
      : Array.from(this.providers.values()).flat();

    for (const provider of providersToCheck) {
      const health = this.healthStatus.get(provider.name);
      const circuitBreaker = this.circuitBreakers.get(provider.name);

      if (health && circuitBreaker) {
        result.set(provider.name, {
          ...health,
          circuitState: circuitBreaker.getCurrentState(),
        });
      }
    }

    return result;
  }

  /**
   * Reset circuit breaker for a specific provider
   */
  resetCircuitBreaker(providerName: string): void {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    if (circuitBreaker) {
      circuitBreaker.reset();
    }
  }

  /**
   * Get registered providers for a blockchain
   */
  getProviders(blockchain: string): IBlockchainProvider[] {
    return this.providers.get(blockchain) || [];
  }

  /**
   * Enforce rate limiting using token bucket algorithm
   * @returns The delay time in milliseconds if rate limited
   */
  private async enforceRateLimit(
    provider: IBlockchainProvider,
  ): Promise<number> {
    const rateLimiter = this.rateLimiters.get(provider.name);
    if (!rateLimiter) {
      return 0; // No rate limiting data
    }

    const now = Date.now();
    const { requestsPerSecond, burstLimit } = provider.rateLimit;
    const maxTokens = burstLimit || 1;
    const refillRate = requestsPerSecond; // tokens per second

    // Calculate how many tokens to add based on time elapsed
    const timeSinceLastRequest = (now - rateLimiter.lastRequest) / 1000; // in seconds
    const tokensToAdd = timeSinceLastRequest * refillRate;

    // Update token count (don't exceed max)
    rateLimiter.tokens = Math.min(maxTokens, rateLimiter.tokens + tokensToAdd);
    rateLimiter.lastRequest = now;

    // If we don't have enough tokens, wait
    if (rateLimiter.tokens < 1) {
      const waitTime = ((1 - rateLimiter.tokens) / refillRate) * 1000; // convert to ms
      await this.delay(waitTime);

      // After waiting, we should have at least 1 token
      rateLimiter.tokens = 1;
      rateLimiter.lastRequest = Date.now();

      // Consume one token
      rateLimiter.tokens -= 1;
      return waitTime;
    }

    // Consume one token
    rateLimiter.tokens -= 1;
    return 0;
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

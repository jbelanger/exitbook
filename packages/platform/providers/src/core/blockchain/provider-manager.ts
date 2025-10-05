import {
  createInitialCircuitState,
  getCircuitStatus,
  isCircuitHalfOpen,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  resetCircuit,
  type CircuitState,
} from '@exitbook/platform-http';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import { ProviderRegistry } from './registry/provider-registry.ts';
import { ProviderError } from './types/errors.ts';
import type {
  FailoverExecutionResult,
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderConfig,
  ProviderHealth,
  ProviderOperation,
  ProviderOperationType,
} from './types/index.ts';
import type { BlockchainExplorersConfig, ProviderOverride } from './utils/config-utils.ts';

const logger = getLogger('BlockchainProviderManager');

interface CacheEntry {
  expiry: number;
  result: unknown;
}

export class BlockchainProviderManager {
  private cacheCleanupTimer?: NodeJS.Timeout | undefined;
  private readonly cacheTimeout = 30000; // 30 seconds
  private circuitStates = new Map<string, CircuitState>();
  private readonly healthCheckInterval = 60000; // 1 minute
  private healthCheckTimer?: NodeJS.Timeout | undefined;
  private healthStatus = new Map<string, ProviderHealth>();
  private providers = new Map<string, IBlockchainProvider[]>();
  private requestCache = new Map<string, CacheEntry>();

  constructor(private readonly explorerConfig: BlockchainExplorersConfig | undefined) {
    // Providers are auto-registered via the import in this file's header

    // Start periodic health checks
    this.healthCheckTimer = setInterval(() => {
      void this.performHealthChecks().catch((error) => {
        logger.error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.healthCheckInterval);

    // Start cache cleanup
    this.cacheCleanupTimer = setInterval(() => this.cleanupCache(), this.cacheTimeout);
  }

  /**
   * Auto-register providers from configuration using the registry
   * Falls back to all registered providers when no configuration exists
   */
  autoRegisterFromConfig(blockchain: string, preferredProvider?: string): IBlockchainProvider[] {
    try {
      // If no config file exists, use all registered providers
      if (!this.explorerConfig) {
        logger.info(`No configuration file found. Using all registered providers for ${blockchain}`);
        return this.autoRegisterFromRegistry(blockchain, preferredProvider);
      }

      const blockchainConfig = this.explorerConfig[blockchain];

      // If blockchain not in config, fall back to registry
      if (!blockchainConfig) {
        logger.info(`No configuration found for blockchain: ${blockchain}. Using all registered providers.`);
        return this.autoRegisterFromRegistry(blockchain, preferredProvider);
      }

      // Use override-based config format
      if (
        typeof blockchainConfig === 'object' &&
        blockchainConfig !== null &&
        (blockchainConfig.defaultEnabled === undefined || Array.isArray(blockchainConfig.defaultEnabled)) &&
        (blockchainConfig.overrides === undefined ||
          (typeof blockchainConfig.overrides === 'object' && blockchainConfig.overrides !== null))
      ) {
        return this.handleOverrideConfig(
          blockchain,
          preferredProvider,
          blockchainConfig as {
            defaultEnabled?: string[] | undefined;
            overrides?: Record<string, ProviderOverride> | undefined;
          }
        );
      } else {
        logger.error(
          `Invalid blockchain config format for ${blockchain}. Expected an object with optional defaultEnabled (string[]) and overrides (Record<string, ProviderOverride>).`
        );
        return [];
      }
    } catch (error) {
      logger.error(
        `Failed to auto-register providers for ${blockchain} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
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
    this.circuitStates.clear();
    this.requestCache.clear();
  }

  /**
   * Execute operation with intelligent failover and caching
   */
  async executeWithFailover<T>(
    blockchain: string,
    operation: ProviderOperation
  ): Promise<Result<FailoverExecutionResult<T>, ProviderError>> {
    // Check cache first
    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation);
      const cached = this.requestCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        const cachedResult = cached.result as Result<FailoverExecutionResult<T>, ProviderError>;
        return cachedResult;
      }
    }

    // Execute with failover logic
    const result = (await this.executeWithCircuitBreaker(blockchain, operation)) as unknown as Result<
      FailoverExecutionResult<T>,
      ProviderError
    >;

    // Cache result if cacheable
    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation);
      this.requestCache.set(cacheKey, {
        expiry: Date.now() + this.cacheTimeout,
        result,
      });
    }

    return result;
  }

  /**
   * Get provider health status for monitoring
   */
  getProviderHealth(blockchain?: string): Map<string, ProviderHealth & { circuitState: string }> {
    const result = new Map<string, ProviderHealth & { circuitState: string }>();

    const providersToCheck = blockchain
      ? this.providers.get(blockchain) || []
      : Array.from(this.providers.values()).flat();

    const now = Date.now();
    for (const provider of providersToCheck) {
      const health = this.healthStatus.get(provider.name);
      const circuitState = this.circuitStates.get(provider.name);

      if (health && circuitState) {
        result.set(provider.name, {
          ...health,
          circuitState: getCircuitStatus(circuitState, now),
        });
      }
    }

    return result;
  }

  /**
   * Get registered providers for a blockchain
   */
  getProviders(blockchain: string): IBlockchainProvider[] {
    return this.providers.get(blockchain) || [];
  }

  /**
   * Register providers for a specific blockchain
   */
  registerProviders(blockchain: string, providers: IBlockchainProvider[]): void {
    this.providers.set(blockchain, providers);

    // Initialize health status and circuit breaker state for each provider
    for (const provider of providers) {
      this.healthStatus.set(provider.name, {
        averageResponseTime: 0,
        consecutiveFailures: 0,
        errorRate: 0,
        isHealthy: true,
        lastChecked: 0,
      });

      this.circuitStates.set(provider.name, createInitialCircuitState());
    }
  }

  /**
   * Reset circuit breaker for a specific provider
   */
  resetCircuitBreaker(providerName: string): void {
    const circuitState = this.circuitStates.get(providerName);
    if (circuitState) {
      this.circuitStates.set(providerName, resetCircuit(circuitState));
    }
  }

  /**
   * Auto-register all available providers from the registry (used when no config exists)
   */
  private autoRegisterFromRegistry(blockchain: string, preferredProvider?: string): IBlockchainProvider[] {
    try {
      let registeredProviders = ProviderRegistry.getAvailable(blockchain);

      // If a preferred provider is specified, filter to only that provider
      if (preferredProvider) {
        const matchingProvider = registeredProviders.find((provider) => provider.name === preferredProvider);
        if (matchingProvider) {
          registeredProviders = [matchingProvider];
          logger.info(`Filtering to preferred provider: ${preferredProvider} for ${blockchain}`);
        } else {
          const availableProviders = registeredProviders.map((p) => p.name).join(', ');
          const suggestions = [
            `💡 Available providers for ${blockchain}: ${availableProviders}`,
            `💡 Run 'pnpm run providers:list --blockchain ${blockchain}' to see all options`,
            `💡 Check for typos in provider name: '${preferredProvider}'`,
            `💡 Use 'pnpm run providers:sync --fix' to sync configuration`,
          ];

          throw new Error(
            `Preferred provider '${preferredProvider}' not found for ${blockchain}.\n${suggestions.join('\n')}`
          );
        }
      }

      const providers: IBlockchainProvider[] = [];
      let priority = 1;

      for (const providerInfo of registeredProviders) {
        try {
          // Get provider metadata from registry
          const metadata = ProviderRegistry.getMetadata(blockchain, providerInfo.name);
          if (!metadata) {
            logger.warn(`No metadata found for provider ${providerInfo.name}. Skipping.`);
            continue;
          }

          // Check if provider requires API key and if it's available
          if (metadata.requiresApiKey) {
            const envVar = metadata.apiKeyEnvVar || `${metadata.name.toUpperCase()}_API_KEY`;
            const apiKey = process.env[envVar];

            if (!apiKey || apiKey === 'YourApiKeyToken') {
              logger.warn(
                `No API key found for ${metadata.displayName}. Set environment variable: ${envVar}. Skipping provider.`
              );
              continue;
            }
          }

          // Determine baseUrl: use chain-specific if available, otherwise use default
          let baseUrl = metadata.baseUrl;

          // If supportedChains is an object format, extract chain-specific baseUrl
          if (metadata.supportedChains && !Array.isArray(metadata.supportedChains)) {
            const chainConfig = metadata.supportedChains[blockchain];
            if (chainConfig?.baseUrl) {
              baseUrl = chainConfig.baseUrl;
            }
          }

          // Build provider config using registry defaults
          const providerConfig: ProviderConfig = {
            ...metadata.defaultConfig,
            baseUrl,
            blockchain, // Add blockchain for multi-chain support
            displayName: metadata.displayName,
            enabled: true,
            name: metadata.name,
            priority: priority++,
            requiresApiKey: metadata.requiresApiKey,
          };

          // Create provider instance from registry
          const provider = ProviderRegistry.createProvider(blockchain, providerInfo.name, providerConfig);
          providers.push(provider);

          logger.debug(
            `Successfully created provider ${providerInfo.name} for ${blockchain} (registry) - Priority: ${providerConfig.priority}, BaseUrl: ${providerConfig.baseUrl}, RequiresApiKey: ${metadata.requiresApiKey}`
          );
        } catch (error) {
          logger.error(
            `Failed to create provider ${providerInfo.name} for ${blockchain} - Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Register the providers with this manager
      if (providers.length > 0) {
        this.registerProviders(blockchain, providers);
        logger.info(
          `Auto-registered ${providers.length} providers from registry for ${blockchain}: ${providers.map((p) => p.name).join(', ')}`
        );
      } else {
        logger.warn(`No suitable providers found for ${blockchain}`);
      }

      return providers;
    } catch (error) {
      logger.error(
        `Failed to auto-register providers from registry for ${blockchain} - Error: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
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
   * Execute with circuit breaker protection and automatic failover
   */
  private async executeWithCircuitBreaker<T>(
    blockchain: string,
    operation: ProviderOperation
  ): Promise<Result<FailoverExecutionResult<T>, ProviderError>> {
    const providers = this.getProvidersInOrder(blockchain, operation);

    if (providers.length === 0) {
      return err(
        new ProviderError(`No providers available for ${blockchain} operation: ${operation.type}`, 'NO_PROVIDERS', {
          blockchain,
          operation: operation.type,
        })
      );
    }

    let lastError: Error | undefined = undefined;
    let attemptNumber = 0;
    const now = Date.now();

    for (const provider of providers) {
      attemptNumber++;
      const circuitState = this.getOrCreateCircuitState(provider.name);

      // Log provider attempt with reason
      if (attemptNumber === 1) {
        logger.debug(`Using provider ${provider.name} for ${operation.type}`);
      } else {
        logger.info(
          `Switching to provider ${provider.name} for ${operation.type} - Reason: ${attemptNumber === 2 ? 'primary_failed' : 'multiple_failures'}, AttemptNumber: ${attemptNumber}, PreviousError: ${lastError?.message}`
        );
      }

      const circuitIsOpen = isCircuitOpen(circuitState, now);
      const circuitIsHalfOpen = isCircuitHalfOpen(circuitState, now);

      // Skip providers with open circuit breakers (unless all are open)
      if (circuitIsOpen && this.hasAvailableProviders(providers)) {
        logger.debug(`Skipping provider ${provider.name} - circuit breaker is open`);
        continue;
      }

      // Log when using a provider with open circuit breaker (all providers are failing)
      if (circuitIsOpen) {
        logger.warn(`Using provider ${provider.name} despite open circuit breaker - all providers unavailable`);
      } else if (circuitIsHalfOpen) {
        logger.debug(`Testing provider ${provider.name} in half-open state`);
      }

      const startTime = Date.now();
      try {
        // Execute operation - rate limiting handled by provider's HttpClient
        const result = await provider.execute(operation, {});
        const responseTime = Date.now() - startTime;

        // Record success - update circuit state
        const newCircuitState = recordSuccess(circuitState, Date.now());
        this.circuitStates.set(provider.name, newCircuitState);
        this.updateHealthMetrics(provider.name, true, responseTime);

        return ok({
          data: result as T,
          providerName: provider.name,
        });
      } catch (error) {
        lastError = error as Error;
        const responseTime = Date.now() - startTime;

        // Log error without sensitive params details
        const logData: {
          attemptNumber: number;
          error: string;
          operation: string;
          params?: unknown;
          provider: string;
          willRetry: boolean;
        } = {
          attemptNumber,
          error: error instanceof Error ? error.message : String(error),
          operation: operation.type,
          provider: provider.name,
          willRetry: attemptNumber < providers.length,
        };
        // Only log params for non-sensitive operations
        if (operation.type === 'custom') {
          logData.params = { type: operation.type };
        }

        if (attemptNumber < providers.length) {
          logger.warn(`Provider ${provider.name} failed, trying next provider: ${logData.error}`);
        } else {
          logger.error(`All providers failed for ${operation.type}: ${logData.error}`);
        }

        // Record failure - update circuit state
        const newCircuitState = recordFailure(circuitState, Date.now());
        this.circuitStates.set(provider.name, newCircuitState);
        this.updateHealthMetrics(provider.name, false, responseTime, lastError.message);

        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    return err(
      new ProviderError(
        `All providers failed for ${blockchain} operation: ${operation.type}. Last error: ${lastError?.message}`,
        'ALL_PROVIDERS_FAILED',
        {
          blockchain,
          ...(lastError?.message && { lastError: lastError.message }),
          operation: operation.type,
        }
      )
    );
  }

  /**
   * Get or create circuit breaker state for provider
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
   * Get providers ordered by preference for the given operation
   */
  private getProvidersInOrder(blockchain: string, operation: ProviderOperation): IBlockchainProvider[] {
    const candidates = this.providers.get(blockchain) || [];

    // Filter by capability and health, then sort by score
    const scoredProviders = candidates
      .filter((p) => this.supportsOperation(p.capabilities, operation.type))
      .map((p) => ({
        health: this.healthStatus.get(p.name)!,
        provider: p,
        score: this.scoreProvider(p),
      }))
      .sort((a, b) => b.score - a.score); // Higher score = better

    // Log provider selection details
    if (scoredProviders.length > 1) {
      logger.debug(
        `Provider selection for ${operation.type} - Providers: ${JSON.stringify(
          scoredProviders.map((item) => ({
            avgResponseTime: Math.round(item.health.averageResponseTime),
            consecutiveFailures: item.health.consecutiveFailures,
            errorRate: Math.round(item.health.errorRate * 100),
            isHealthy: item.health.isHealthy,
            name: item.provider.name,
            rateLimitPerSec: item.provider.rateLimit.requestsPerSecond,
            score: item.score,
          }))
        )}`
      );
    }

    return scoredProviders.map((item) => item.provider);
  }

  /**
   * Handle new override-based configuration format
   */
  private handleOverrideConfig(
    blockchain: string,
    preferredProvider: string | undefined,
    blockchainConfig: {
      defaultEnabled?: string[] | undefined;
      overrides?: Record<string, ProviderOverride> | undefined;
    }
  ): IBlockchainProvider[] {
    // Get all registered providers for this blockchain
    const allRegisteredProviders = ProviderRegistry.getAvailable(blockchain);

    // Determine which providers to enable
    const defaultEnabled = blockchainConfig.defaultEnabled || allRegisteredProviders.map((p) => p.name);
    const overrides = blockchainConfig.overrides || {};

    // Build list of providers to create
    const providersToCreate: {
      name: string;
      overrideConfig: ProviderOverride;
      priority: number;
    }[] = [];

    // If preferred provider specified, use only that one
    if (preferredProvider) {
      if (allRegisteredProviders.some((p) => p.name === preferredProvider)) {
        const override = overrides[preferredProvider] || {};
        // Check if explicitly disabled
        if (override.enabled === false) {
          logger.warn(`Preferred provider '${preferredProvider}' is disabled in config overrides`);
        } else {
          providersToCreate.push({
            name: preferredProvider,
            overrideConfig: override,
            priority: override.priority || 1,
          });
        }
      } else {
        const registeredProviders = allRegisteredProviders.map((p) => p.name).join(', ');
        const suggestions = [
          `💡 Available providers for ${blockchain}: ${registeredProviders}`,
          `💡 Run 'pnpm run providers:list --blockchain ${blockchain}' to see all options`,
          `💡 Check for typos in provider name: '${preferredProvider}'`,
          `💡 Use 'pnpm run providers:sync --fix' to sync configuration`,
        ];

        throw new Error(
          `Preferred provider '${preferredProvider}' not found for ${blockchain}.\n${suggestions.join('\n')}`
        );
      }
    } else {
      // Use defaultEnabled list, filtered by overrides
      for (const providerName of defaultEnabled) {
        if (!allRegisteredProviders.some((p) => p.name === providerName)) {
          logger.warn(`Default provider '${providerName}' not registered for ${blockchain}. Skipping.`);
          continue;
        }

        const override = overrides[providerName] || {};

        // Skip if explicitly disabled
        if (override.enabled === false) {
          logger.debug(`Provider '${providerName}' disabled via config override for ${blockchain}`);
          continue;
        }

        providersToCreate.push({
          name: providerName,
          overrideConfig: override,
          priority: override.priority || providersToCreate.length + 1,
        });
      }

      // Sort by priority
      providersToCreate.sort((a, b) => a.priority - b.priority);
    }

    const providers: IBlockchainProvider[] = [];

    for (const providerInfo of providersToCreate) {
      try {
        // Get provider metadata from registry
        const metadata = ProviderRegistry.getMetadata(blockchain, providerInfo.name);
        if (!metadata) {
          logger.warn(`No metadata found for provider ${providerInfo.name}. Skipping.`);
          continue;
        }

        // Check API key requirements
        if (metadata.requiresApiKey) {
          const envVar = metadata.apiKeyEnvVar || `${metadata.name.toUpperCase()}_API_KEY`;
          const apiKey = process.env[envVar];

          if (!apiKey || apiKey === 'YourApiKeyToken') {
            logger.warn(
              `No API key found for ${metadata.displayName}. Set environment variable: ${envVar}. Skipping provider.`
            );
            continue;
          }
        }

        // Determine baseUrl: use chain-specific if available, otherwise use default
        let baseUrl = metadata.baseUrl;

        // If supportedChains is an object format, extract chain-specific baseUrl
        if (metadata.supportedChains && !Array.isArray(metadata.supportedChains)) {
          const chainConfig = metadata.supportedChains[blockchain];
          if (chainConfig?.baseUrl) {
            baseUrl = chainConfig.baseUrl;
          }
        }

        // Build provider config by merging registry defaults with overrides
        // Properly merge rateLimit to ensure required fields are present
        const overrideRateLimit = providerInfo.overrideConfig.rateLimit;
        const providerConfig: ProviderConfig = {
          baseUrl,
          blockchain, // Add blockchain for multi-chain support
          displayName: metadata.displayName,
          enabled: true,
          name: metadata.name,
          priority: providerInfo.priority,
          rateLimit: {
            burstLimit: overrideRateLimit?.burstLimit ?? metadata.defaultConfig.rateLimit.burstLimit,
            requestsPerHour: overrideRateLimit?.requestsPerHour ?? metadata.defaultConfig.rateLimit.requestsPerHour,
            requestsPerMinute:
              overrideRateLimit?.requestsPerMinute ?? metadata.defaultConfig.rateLimit.requestsPerMinute,
            requestsPerSecond:
              overrideRateLimit?.requestsPerSecond ?? metadata.defaultConfig.rateLimit.requestsPerSecond,
          },
          requiresApiKey: metadata.requiresApiKey,
          retries: providerInfo.overrideConfig.retries ?? metadata.defaultConfig.retries,
          timeout: providerInfo.overrideConfig.timeout ?? metadata.defaultConfig.timeout,
        };

        // Create provider instance
        const provider = ProviderRegistry.createProvider(blockchain, providerInfo.name, providerConfig);
        providers.push(provider);

        logger.debug(
          `Created provider ${providerInfo.name} for ${blockchain} - Priority: ${providerInfo.priority}, BaseUrl: ${providerConfig.baseUrl}, RequiresApiKey: ${metadata.requiresApiKey}`
        );
      } catch (error) {
        logger.error(
          `Failed to create provider ${providerInfo.name} for ${blockchain} - Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Register providers with manager
    if (providers.length > 0) {
      this.registerProviders(blockchain, providers);
      logger.info(
        `Auto-registered ${providers.length} providers for ${blockchain}: ${providers.map((p) => p.name).join(', ')}`
      );
    } else {
      logger.warn(`No suitable providers found for ${blockchain}`);
    }

    return providers;
  }

  /**
   * Check if there are available providers (circuit not open)
   */
  private hasAvailableProviders(providers: IBlockchainProvider[]): boolean {
    const now = Date.now();
    return providers.some((p) => {
      const circuitState = this.circuitStates.get(p.name);
      return !circuitState || !isCircuitOpen(circuitState, now);
    });
  }

  /**
   * Perform periodic health checks on all providers
   */
  private async performHealthChecks(): Promise<void> {
    for (const [, providers] of this.providers.entries()) {
      for (const provider of providers) {
        try {
          const startTime = Date.now();
          const result = await provider.isHealthy();
          const responseTime = Date.now() - startTime;

          if (result.isErr()) {
            this.updateHealthMetrics(provider.name, false, responseTime, result.error.message);
          } else {
            this.updateHealthMetrics(provider.name, result.value, responseTime);
          }
        } catch (error) {
          this.updateHealthMetrics(
            provider.name,
            false,
            0,
            error instanceof Error ? error.message : 'Health check failed'
          );
        }
      }
    }
  }

  /**
   * Score a provider based on health, performance, and availability
   */
  private scoreProvider(provider: IBlockchainProvider): number {
    const health = this.healthStatus.get(provider.name);
    const circuitState = this.circuitStates.get(provider.name);

    if (!health || !circuitState) {
      return 0;
    }

    const now = Date.now();
    let score = 100; // Base score

    // Health penalties
    if (!health.isHealthy) score -= 50;
    if (isCircuitOpen(circuitState, now)) score -= 100; // Severe penalty for open circuit
    if (isCircuitHalfOpen(circuitState, now)) score -= 25; // Moderate penalty for half-open

    // Rate limit penalties - both configured limits and actual rate limiting events
    const rateLimit = provider.rateLimit.requestsPerSecond;
    if (rateLimit <= 0.5)
      score -= 40; // Very restrictive (like mempool.space 0.25/sec)
    else if (rateLimit <= 1.0)
      score -= 20; // Moderately restrictive
    else if (rateLimit >= 3.0) score += 10; // Generous rate limits get bonus

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
   * Check if provider supports the requested operation
   */
  private supportsOperation(capabilities: ProviderCapabilities, operationType: string): boolean {
    return capabilities.supportedOperations.includes(operationType as ProviderOperationType);
  }

  /**
   * Update health metrics for a provider
   */
  private updateHealthMetrics(
    providerName: string,
    success: boolean,
    responseTime: number,
    errorMessage?: string
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
        health.averageResponseTime === 0 ? responseTime : health.averageResponseTime * 0.8 + responseTime * 0.2;
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
  }
}

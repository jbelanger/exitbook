import { getErrorMessage, type CursorState } from '@exitbook/core';
import {
  createInitialCircuitState,
  isCircuitHalfOpen,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  resetCircuit,
  type CircuitState,
} from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import {
  buildProviderNotFoundError,
  buildProviderSelectionDebugInfo,
  canProviderResume,
  createDeduplicationWindow,
  createInitialHealth,
  deduplicateTransactions,
  getProviderHealthWithCircuit,
  hasAvailableProviders,
  resolveCursorForResumption,
  selectProvidersForOperation,
  updateHealthMetrics,
  validateProviderApiKey,
} from './provider-manager-utils.js';
import { ProviderRegistry } from './registry/provider-registry.js';
import { ProviderError } from './types/errors.js';
import type {
  FailoverExecutionResult,
  FailoverStreamingExecutionResult,
  IBlockchainProvider,
  ProviderConfig,
  ProviderHealth,
  OneShotOperation,
  ProviderOperation,
  StreamingOperation,
} from './types/index.js';
import type { BlockchainExplorersConfig, ProviderOverride } from './utils/config-utils.js';

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

  constructor(private readonly explorerConfig?: BlockchainExplorersConfig | undefined) {
    // Providers are auto-registered via the import in this file's header

    // Start periodic health checks
    this.healthCheckTimer = setInterval(() => {
      void this.performHealthChecks().catch((error) => {
        logger.error(`Health check failed: ${getErrorMessage(error)}`);
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
    const existingProviders = this.providers.get(blockchain);

    // Fast path: if providers already registered, skip redundant work/log noise
    if (existingProviders && existingProviders.length > 0) {
      if (!preferredProvider) {
        logger.debug(`Providers already registered for ${blockchain}; skipping auto-registration`);
        return existingProviders;
      }

      const preferredAlreadyRegistered =
        existingProviders.length === 1 && existingProviders[0]?.name === preferredProvider;
      if (preferredAlreadyRegistered) {
        logger.debug(
          `Preferred provider '${preferredProvider}' already registered for ${blockchain}; skipping auto-registration`
        );
        return existingProviders;
      }

      logger.info(
        `Re-registering providers for ${blockchain} to honor preferred provider '${preferredProvider}' (existing: ${existingProviders.map((p) => p.name).join(', ')})`
      );
    }

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
      logger.error(`Failed to auto-register providers for ${blockchain} - Error: ${getErrorMessage(error)}`);
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

  // // Streaming overload
  // async *executeWithFailover<T>(
  //   blockchain: string,
  //   operation: StreamingOperation,
  //   resumeCursor?: CursorState
  // ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>>;

  // // One-shot overload (still returns iterator for uniformity)
  // async *executeWithFailover<T>(
  //   blockchain: string,
  //   operation: OneShotOperation,
  //   resumeCursor?: CursorState
  // ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>>;

  /**
   * Execute operation with intelligent failover - unified iterator API
   *
   * This method provides a consistent interface for both streaming and one-shot operations:
   * - Transaction fetching operations (getAddressTransactions, etc.) yield multiple batches with pagination
   * - One-shot operations (getBalance, getTokenMetadata, etc.) yield exactly once
   *
   * All operations return an AsyncIterableIterator for consistency. Consumers always use:
   * ```typescript
   * for await (const batchResult of manager.executeWithFailover(blockchain, operation)) {
   *   if (batchResult.isErr()) { handle error }
   *   const batch = batchResult.value;
   *   // process batch.data
   * }
   * ```
   *
   * @param blockchain - Blockchain identifier (e.g., 'ethereum', 'bitcoin')
   * @param operation - Operation to execute
   * @param resumeCursor - Optional cursor for resuming streaming operations (ignored for one-shot)
   * @returns AsyncIterableIterator yielding Result-wrapped batches
   */
  async *executeWithFailover<T>(
    blockchain: string,
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>> {
    // Define which operations require streaming pagination
    const STREAMING_OPERATIONS: StreamingOperation['type'][] = [
      'getAddressTransactions',
      'getAddressInternalTransactions',
      'getAddressTokenTransactions',
    ];
    const isStreamingOperation = (op: ProviderOperation): op is StreamingOperation =>
      STREAMING_OPERATIONS.includes(op.type as StreamingOperation['type']);

    if (isStreamingOperation(operation)) {
      // Multi-batch streaming with pagination support
      yield* this.executeStreamingImpl<T>(blockchain, operation, resumeCursor);
    } else {
      // One-shot operation - yield single batch and complete
      const result = await this.executeOneShotImpl<T>(blockchain, operation);

      if (result.isErr()) {
        yield err(result.error);
        return;
      }

      // Wrap one-shot result as single-element batch with completion marker
      yield ok({
        data: [result.value.data] as T[],
        providerName: result.value.providerName,
        cursor: {
          primary: { type: 'blockNumber' as const, value: 0 },
          lastTransactionId: '',
          totalFetched: 1,
          metadata: {
            providerName: result.value.providerName,
            updatedAt: Date.now(),
            isComplete: true,
          },
        },
      });
    }
  }

  /**
   * Helper method for one-shot operations - consumes first yielded result
   *
   * Use this for operations that always yield exactly once (getBalance, getTokenMetadata, hasAddressTransactions, etc.).
   * For transaction fetching operations that may yield multiple batches, use executeWithFailover directly.
   *
   * @example
   * ```typescript
   * const result = await manager.executeWithFailoverOnce(blockchain, {
   *   type: 'getBalance',
   *   address: '0x...'
   * });
   * if (result.isOk()) {
   *   const balance = result.value.data; // Direct access to data (unwrapped from array)
   * }
   * ```
   */
  async executeWithFailoverOnce<T>(
    blockchain: string,
    operation: OneShotOperation
  ): Promise<Result<FailoverExecutionResult<T>, Error>> {
    // Runtime guard in case typing is bypassed
    const STREAMING_OPERATIONS = new Set<ProviderOperation['type']>([
      'getAddressTransactions',
      'getAddressInternalTransactions',
      'getAddressTokenTransactions',
    ]);
    if (STREAMING_OPERATIONS.has(operation.type)) {
      return err(
        new Error(
          `executeWithFailoverOnce is only for one-shot operations; received streaming operation: ${operation.type}`
        )
      );
    }

    let seenBatch = false;
    for await (const batchResult of this.executeWithFailover<T>(blockchain, operation)) {
      if (batchResult.isErr()) {
        return err(batchResult.error);
      }

      // Extract first item from batch array for one-shot operations
      const data = batchResult.value.data[0];
      if (data === undefined) {
        return err(new Error('One-shot operation yielded empty batch'));
      }
      if (seenBatch) {
        return err(
          new Error(
            `One-shot operation yielded multiple batches. Use executeWithFailover for streaming operations. Operation: ${operation.type}`
          )
        );
      }
      seenBatch = true;
      return ok({
        data,
        providerName: batchResult.value.providerName,
      });
    }

    // Should never reach here for valid one-shot operations
    return err(new Error('No result yielded from one-shot operation'));
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
        result.set(provider.name, getProviderHealthWithCircuit(health, circuitState, now));
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
      this.healthStatus.set(provider.name, createInitialHealth());
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
          const availableProviders = registeredProviders.map((p) => p.name);
          throw new Error(buildProviderNotFoundError(blockchain, preferredProvider, availableProviders));
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
            const validation = validateProviderApiKey(metadata);
            if (!validation.available) {
              logger.warn(
                `No API key found for ${metadata.displayName}. Set environment variable: ${validation.envVar}. Skipping provider.`
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
            `Failed to create provider ${providerInfo.name} for ${blockchain} - Error: ${getErrorMessage(error)}`
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
        `Failed to auto-register providers from registry for ${blockchain} - Error: ${getErrorMessage(error)}`
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
   * Execute operation with streaming pagination and intelligent failover
   *
   * Supports:
   * - Mid-pagination provider switching
   * - Cross-provider cursor translation
   * - Automatic deduplication after replay windows
   * - Progress tracking
   *
   * @private Internal implementation for streaming operations
   */
  private async *executeStreamingImpl<T>(
    blockchain: string,
    operation: ProviderOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>> {
    const providers = this.getProvidersInOrder(blockchain, operation);

    if (providers.length === 0) {
      yield err(
        new ProviderError(`No providers available for ${blockchain} operation: ${operation.type}`, 'NO_PROVIDERS', {
          blockchain,
          operation: operation.type,
        })
      );
      return;
    }

    let currentCursor = resumeCursor;
    let providerIndex = 0;

    // Bounded deduplication window prevents unbounded memory growth during long streams
    // Window size (1000) covers typical replay overlap: 5 blocks × ~200 txs/block
    const DEDUP_WINDOW_SIZE = 1000;

    // ✅ CRITICAL: Populate dedup set from recent database transactions to prevent duplicates
    // during replay window (5 blocks/minutes can be dozens of transactions)
    const initialIds = resumeCursor ? [resumeCursor.lastTransactionId] : [];
    // TODO Phase 2.3: Use loadRecentTransactionIds() from utils to seed dedup set from storage
    const deduplicationWindow = createDeduplicationWindow(initialIds);

    while (providerIndex < providers.length) {
      const provider = providers[providerIndex];
      if (!provider) {
        providerIndex++;
        continue;
      }

      // Check cursor compatibility
      if (currentCursor && !canProviderResume(provider, currentCursor)) {
        const supportedTypes = provider.capabilities.supportedCursorTypes?.join(', ') || 'none';
        logger.warn(
          `Provider ${provider.name} cannot resume from cursor type ${currentCursor.primary.type}. ` +
            `Supported types: ${supportedTypes}. Trying next provider.`
        );
        providerIndex++;
        continue;
      }

      const isFailover = currentCursor ? currentCursor.metadata?.providerName !== provider.name : false;

      // Use manager's cursor resolution for ALL cursor handling
      // This handles: same-provider resumption, cross-provider failover, replay windows
      const adjustedCursor = currentCursor
        ? (() => {
            const resolved = resolveCursorForResumption(
              currentCursor,
              {
                providerName: provider.name,
                supportedCursorTypes: provider.capabilities.supportedCursorTypes || [],
                isFailover, // Only apply replay window during cross-provider failover
                applyReplayWindow: (c) => provider.applyReplayWindow(c),
              },
              logger
            );

            // Convert resolved cursor back to CursorState format
            // Manager resolves to the specific value, provider just needs to receive it
            if (resolved.pageToken) {
              return {
                ...currentCursor,
                primary: { type: 'pageToken' as const, value: resolved.pageToken, providerName: provider.name },
              };
            } else if (resolved.fromBlock !== undefined) {
              return {
                ...currentCursor,
                primary: { type: 'blockNumber' as const, value: resolved.fromBlock },
              };
            } else if (resolved.fromTimestamp !== undefined) {
              return {
                ...currentCursor,
                primary: { type: 'timestamp' as const, value: resolved.fromTimestamp },
              };
            }
            return currentCursor;
          })()
        : undefined;

      logger.info(
        `Using provider ${provider.name} for ${operation.type}` +
          (isFailover
            ? ` (failover from ${currentCursor!.metadata?.providerName}, replay window applied)`
            : currentCursor
              ? ` (resuming same provider)`
              : '')
      );

      try {
        const iterator = provider.executeStreaming(operation, adjustedCursor);

        let providerFailed = false;
        for await (const batchResult of iterator) {
          // ✅ Check Result wrapper from provider
          if (batchResult.isErr()) {
            logger.error(`Provider ${provider.name} batch failed: ${getErrorMessage(batchResult.error)}`);

            // Record failure and try next provider
            const circuitState = this.getOrCreateCircuitState(provider.name);
            this.circuitStates.set(provider.name, recordFailure(circuitState, Date.now()));
            this.updateProviderHealth(provider.name, false, 0, getErrorMessage(batchResult.error));

            providerIndex++;
            providerFailed = true;
            break; // Break inner loop, continue outer loop to try next provider
          }

          const batch = batchResult.value;

          // Deduplicate (especially important after failover with replay window)
          // Note: deduplicateTransactions mutates deduplicationWindow in place for performance
          const deduplicated = deduplicateTransactions(
            batch.data as { normalized: { id: string } }[],
            deduplicationWindow,
            DEDUP_WINDOW_SIZE
          );

          // Critical: Always yield completion batches, even with zero data after dedup
          // Otherwise importer never receives "complete" signal when last page contains only duplicates
          const isComplete = batch.cursor.metadata?.isComplete ?? false;
          if (deduplicated.length > 0 || isComplete) {
            yield ok({
              data: deduplicated as T[],
              providerName: provider.name,
              cursor: batch.cursor,
            });
          }

          currentCursor = batch.cursor;

          // Record success for circuit breaker
          const circuitState = this.getOrCreateCircuitState(provider.name);
          this.circuitStates.set(provider.name, recordSuccess(circuitState, Date.now()));
        }

        // If provider failed during streaming, continue to next provider
        if (providerFailed) {
          continue;
        }

        logger.info(`Provider ${provider.name} completed successfully`);
        return;
      } catch (error) {
        // ✅ Unexpected errors (outside Result chain) - wrap and yield
        const errorMessage = getErrorMessage(error);
        logger.error(`Provider ${provider.name} failed with unexpected error: ${errorMessage}`);

        // Record failure
        const circuitState = this.getOrCreateCircuitState(provider.name);
        this.circuitStates.set(provider.name, recordFailure(circuitState, Date.now()));
        this.updateProviderHealth(provider.name, false, 0, errorMessage);

        // Try next provider
        providerIndex++;

        if (providerIndex < providers.length) {
          const nextProvider = providers[providerIndex];
          if (nextProvider) {
            logger.info(`Failing over to ${nextProvider.name}`);
          }
        } else {
          // All providers exhausted - yield error
          yield err(
            new ProviderError(
              `All providers exhausted for ${blockchain}. Last error: ${errorMessage}`,
              'ALL_PROVIDERS_FAILED',
              { blockchain, operation: operation.type, lastError: errorMessage }
            )
          );
          return;
        }
      }
    }

    // No compatible providers found
    yield err(
      new ProviderError(`No compatible providers found for ${blockchain}`, 'NO_COMPATIBLE_PROVIDERS', {
        blockchain,
        operation: operation.type,
      })
    );
  }

  /**
   * Execute operation with intelligent failover and caching
   *
   * @private Internal implementation for one-shot operations
   */
  private async executeOneShotImpl<T>(
    blockchain: string,
    operation: OneShotOperation
  ): Promise<Result<FailoverExecutionResult<T>, ProviderError>> {
    // Auto-register providers for this blockchain if not already registered
    const existingProviders = this.providers.get(blockchain);
    if (!existingProviders || existingProviders.length === 0) {
      this.autoRegisterFromConfig(blockchain);
    }

    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation);
      const cached = this.requestCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        const cachedResult = cached.result as Result<FailoverExecutionResult<T>, ProviderError>;
        return cachedResult;
      }
    }

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
      if (circuitIsOpen && hasAvailableProviders(providers, this.circuitStates, now)) {
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
        const result = await provider.execute<T>(operation, {});

        // Unwrap Result type - throw error to trigger failover
        if (result.isErr()) {
          throw result.error;
        }

        const responseTime = Date.now() - startTime;

        // Record success - update circuit state
        const newCircuitState = recordSuccess(circuitState, Date.now());
        this.circuitStates.set(provider.name, newCircuitState);
        this.updateProviderHealth(provider.name, true, responseTime);

        return ok({
          data: result.value,
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
          error: getErrorMessage(error),
          operation: operation.type,
          provider: provider.name,
          willRetry: attemptNumber < providers.length,
        };

        if (attemptNumber < providers.length) {
          logger.warn(`Provider ${provider.name} failed, trying next provider: ${logData.error}`);
        } else {
          logger.error(`All providers failed for ${operation.type}: ${logData.error}`);
        }

        // Record failure - update circuit state
        const newCircuitState = recordFailure(circuitState, Date.now());
        this.circuitStates.set(provider.name, newCircuitState);
        this.updateProviderHealth(provider.name, false, responseTime, lastError.message);

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
   * Update health metrics for a provider (DRY helper)
   */
  private updateProviderHealth(
    providerName: string,
    success: boolean,
    responseTime: number,
    errorMessage?: string
  ): void {
    const currentHealth = this.healthStatus.get(providerName);
    if (currentHealth) {
      const updatedHealth = updateHealthMetrics(currentHealth, success, responseTime, Date.now(), errorMessage);
      this.healthStatus.set(providerName, updatedHealth);
    }
  }

  /**
   * Get providers ordered by preference for the given operation
   */
  private getProvidersInOrder(blockchain: string, operation: ProviderOperation): IBlockchainProvider[] {
    const candidates = this.providers.get(blockchain) || [];
    const now = Date.now();

    const scoredProviders = selectProvidersForOperation(
      candidates,
      this.healthStatus,
      this.circuitStates,
      operation.type,
      now
    );

    // Log provider selection details
    if (scoredProviders.length > 1) {
      logger.debug(
        `Provider selection for ${operation.type} - Providers: ${buildProviderSelectionDebugInfo(scoredProviders)}`
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
        const availableProviders = allRegisteredProviders.map((p) => p.name);
        throw new Error(buildProviderNotFoundError(blockchain, preferredProvider, availableProviders));
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
          const validation = validateProviderApiKey(metadata);
          if (!validation.available) {
            logger.warn(
              `No API key found for ${metadata.displayName}. Set environment variable: ${validation.envVar}. Skipping provider.`
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
          `Failed to create provider ${providerInfo.name} for ${blockchain} - Error: ${getErrorMessage(error)}`
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
            this.updateProviderHealth(provider.name, false, responseTime, result.error.message);
          } else {
            this.updateProviderHealth(provider.name, result.value, responseTime);
          }
        } catch (error) {
          this.updateProviderHealth(provider.name, false, 0, getErrorMessage(error, 'Health check failed'));
        }
      }
    }
  }
}

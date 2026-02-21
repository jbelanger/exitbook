import { getErrorMessage, type CursorState } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import { TtlCache } from '@exitbook/resilience/cache';
import {
  CircuitBreakerRegistry,
  isCircuitOpen,
  type CircuitState,
  type CircuitStatus,
} from '@exitbook/resilience/circuit-breaker';
import { executeWithFailover } from '@exitbook/resilience/failover';
import { buildProviderSelectionDebugInfo } from '@exitbook/resilience/provider-selection';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderEvent } from '../../events.js';
import type { ProviderStatsQueries } from '../../persistence/queries/provider-stats-queries.js';
import { ProviderInstanceFactory } from '../factory/provider-instance-factory.js';
import { ProviderHealthMonitor } from '../health/provider-health-monitor.js';
import { getProviderKey, ProviderStatsStore, type ProviderStatsStoreOptions } from '../health/provider-stats-store.js';
import type { NormalizedTransactionBase } from '../index.js';
import type { ProviderRegistry } from '../registry/provider-registry.js';
import { ProviderError } from '../types/errors.js';
import type {
  FailoverExecutionResult,
  FailoverStreamingExecutionResult,
  IBlockchainProvider,
  ProviderHealth,
  OneShotOperation,
  OneShotOperationResult,
  ProviderOperation,
  StreamingOperation,
} from '../types/index.js';
import type { BlockchainExplorersConfig } from '../utils/config-utils.js';

import { emitProviderTransition } from './provider-manager-events.js';
import {
  canProviderResume,
  createDeduplicationWindow,
  DEFAULT_DEDUP_WINDOW_SIZE,
  deduplicateTransactions,
  resolveCursorStateForProvider,
  selectProvidersForOperation,
} from './provider-manager-utils.js';

const logger = getLogger('BlockchainProviderManager');

export interface BlockchainProviderManagerOptions {
  explorerConfig?: BlockchainExplorersConfig | undefined;
  statsStore?: ProviderStatsStoreOptions | undefined;
  instrumentation?: InstrumentationCollector | undefined;
  eventBus?: EventBus<ProviderEvent> | undefined;
  statsQueries?: ProviderStatsQueries | undefined;
}

export class BlockchainProviderManager {
  private readonly circuitBreakers = new CircuitBreakerRegistry();
  private readonly statsStore: ProviderStatsStore;
  private readonly responseCache = new TtlCache();
  private readonly healthMonitor: ProviderHealthMonitor;
  private readonly instanceFactory: ProviderInstanceFactory;

  private instrumentation?: InstrumentationCollector | undefined;
  private eventBus?: EventBus<ProviderEvent> | undefined;
  private providers = new Map<string, IBlockchainProvider[]>();
  private preferredProviders = new Map<string, string>(); // blockchain -> preferred provider name

  constructor(registry: ProviderRegistry, options?: BlockchainProviderManagerOptions) {
    this.statsStore = new ProviderStatsStore(options?.statsStore);
    this.instanceFactory = new ProviderInstanceFactory(registry, options?.explorerConfig);
    this.healthMonitor = new ProviderHealthMonitor(
      () => this.providers,
      (blockchain, providerName, success, responseTime, error) => {
        this.statsStore.updateHealth(getProviderKey(blockchain, providerName), success, responseTime, error);
      }
    );

    this.instrumentation = options?.instrumentation;
    this.eventBus = options?.eventBus;
    if (options?.statsQueries) {
      this.statsStore.setQueries(options.statsQueries);
    }

    this.syncFactoryContext();
  }

  /**
   * Start background tasks (health checks, cache cleanup).
   * Must be called explicitly — constructor no longer starts timers.
   * CLI factory calls this; tests skip it to avoid timer leaks.
   */
  startBackgroundTasks(): void {
    this.healthMonitor.start();
    this.responseCache.startAutoCleanup();
  }

  /**
   * Auto-register providers from configuration using the registry.
   * Falls back to all registered providers when no configuration exists.
   * Idempotent: skips if providers are already registered (unless preferred provider changed).
   */
  autoRegisterFromConfig(blockchain: string, preferredProvider?: string): IBlockchainProvider[] {
    const existingProviders = this.providers.get(blockchain);

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
      const result = this.instanceFactory.createProvidersForBlockchain(blockchain, preferredProvider);

      if (result.preferredProviderName) {
        this.preferredProviders.set(blockchain, result.preferredProviderName);
      }

      if (result.providers.length > 0) {
        this.registerProviders(blockchain, result.providers);
      }

      return result.providers;
    } catch (error) {
      logger.error(`Failed to auto-register providers for ${blockchain} - Error: ${getErrorMessage(error)}`);
      return [];
    }
  }

  /**
   * Cleanup resources and stop background tasks
   *
   * Idempotent: safe to call multiple times.
   */
  async destroy(): Promise<void> {
    this.healthMonitor.stop();
    this.responseCache.stopAutoCleanup();

    // Persist stats before clearing maps (best-effort — must not block cleanup)
    try {
      await this.statsStore.save(this.circuitBreakers);
    } catch (error) {
      logger.warn(`Failed to save provider stats on destroy: ${getErrorMessage(error)}`);
    }

    const closePromises: Promise<void>[] = [];

    for (const providerList of this.providers.values()) {
      for (const provider of providerList) {
        closePromises.push(provider.destroy());
      }
    }

    const results = await Promise.allSettled(closePromises);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    for (const failure of failures) {
      const errorMessage = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
      logger.error(`Provider cleanup failed: ${errorMessage}`);
    }

    this.providers.clear();
    this.statsStore.clear();
    this.circuitBreakers.clear();
    this.responseCache.clear();

    if (failures.length > 0) {
      throw new Error(`Provider manager cleanup failed: ${failures.length} provider(s) failed to close`);
    }
  }

  /**
   * Execute streaming operation with intelligent failover
   *
   * Yields multiple batches with pagination and cursor state for transaction fetching.
   * For one-shot operations (getBalance, getTokenMetadata, etc.), use executeWithFailoverOnce instead.
   *
   * @param blockchain - Blockchain identifier (e.g., 'ethereum', 'bitcoin')
   * @param operation - Streaming operation (getAddressTransactions)
   * @param resumeCursor - Optional cursor for resuming from a previous position
   * @returns AsyncIterableIterator yielding Result-wrapped batches with cursor state
   */
  async *executeWithFailover<T>(
    blockchain: string,
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>> {
    yield* this.executeStreamingImpl<T>(blockchain, operation, resumeCursor);
  }

  /**
   * Helper method for one-shot operations - consumes first yielded result
   *
   * Use this for operations that always yield exactly once (getBalance, getTokenMetadata, hasAddressTransactions, etc.).
   * For transaction fetching operations that may yield multiple batches, use executeWithFailover directly.
   */
  async executeWithFailoverOnce<TOperation extends OneShotOperation>(
    blockchain: string,
    operation: TOperation
  ): Promise<Result<FailoverExecutionResult<OneShotOperationResult<TOperation>>, Error>> {
    return this.executeOneShotImpl(blockchain, operation);
  }

  /**
   * Get provider health status for monitoring
   *
   * When blockchain is specified: returns map keyed by provider name
   * When blockchain is omitted: returns map keyed by "blockchain/providerName" to avoid collisions
   */
  getProviderHealth(blockchain?: string): Map<string, ProviderHealth & { circuitState: CircuitStatus }> {
    const result = new Map<string, ProviderHealth & { circuitState: CircuitStatus }>();

    // Iterate entries so we always use the registration blockchain as the key,
    // not provider.blockchain (which may differ for manually-registered providers).
    const entries: [string, IBlockchainProvider[]][] = blockchain
      ? [[blockchain, this.providers.get(blockchain) ?? []]]
      : Array.from(this.providers.entries());

    const now = Date.now();
    for (const [registrationBlockchain, providers] of entries) {
      for (const provider of providers) {
        const providerKey = getProviderKey(registrationBlockchain, provider.name);
        const circuitState = this.circuitBreakers.get(providerKey);

        if (circuitState) {
          const healthWithCircuit = this.statsStore.getProviderHealthWithCircuit(providerKey, circuitState, now);
          if (healthWithCircuit) {
            // Use composite key only when querying across blockchains to prevent collisions
            const mapKey = blockchain ? provider.name : providerKey;
            result.set(mapKey, healthWithCircuit);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get registered providers for a blockchain
   */
  getProviders(blockchain: string): IBlockchainProvider[] {
    return this.providers.get(blockchain) ?? [];
  }

  /**
   * Register providers for a specific blockchain.
   * Guards with has() checks so persisted stats loaded via loadPersistedStats() aren't overwritten.
   */
  registerProviders(blockchain: string, providers: IBlockchainProvider[]): void {
    this.providers.set(blockchain, providers);

    for (const provider of providers) {
      const providerKey = getProviderKey(blockchain, provider.name);

      // Only initialize if not already loaded from persisted stats
      this.statsStore.initializeProvider(providerKey);
      if (!this.circuitBreakers.has(providerKey)) {
        this.circuitBreakers.getOrCreate(providerKey);
      }
    }
  }

  /**
   * Reset circuit breaker for a specific provider
   */
  resetCircuitBreaker(blockchain: string, providerName: string): void {
    this.circuitBreakers.reset(getProviderKey(blockchain, providerName));
  }

  /**
   * Load persisted provider stats from the database.
   * Must be called after construction (with statsQueries) and before providers are registered
   * so that registerProviders() sees existing health/circuit data and skips re-initialization.
   */
  async loadPersistedStats(): Promise<void> {
    await this.statsStore.load(this.circuitBreakers);
  }

  /**
   * Rebuild the factory context from current manager state.
   * Called once at end of constructor.
   */
  private syncFactoryContext(): void {
    this.instanceFactory.setContext({
      instrumentation: this.instrumentation,
      buildHttpClientHooks: (blockchain, providerName) => ({
        onRequestStart: (event) => {
          this.eventBus?.emit({
            type: 'provider.request.started',
            blockchain,
            provider: providerName,
            endpoint: event.endpoint,
            method: event.method,
          });
        },
        onRequestSuccess: (event) => {
          this.eventBus?.emit({
            type: 'provider.request.succeeded',
            blockchain,
            provider: providerName,
            endpoint: event.endpoint,
            method: event.method,
            status: event.status,
            durationMs: event.durationMs,
          });
        },
        onRequestFailure: (event) => {
          this.eventBus?.emit({
            type: 'provider.request.failed',
            blockchain,
            provider: providerName,
            endpoint: event.endpoint,
            method: event.method,
            error: event.error,
            ...(event.status !== undefined && { status: event.status }),
            durationMs: event.durationMs,
          });
        },
        onRateLimited: (event) => {
          this.eventBus?.emit({
            type: 'provider.rate_limited',
            blockchain,
            provider: providerName,
            ...(event.retryAfterMs !== undefined && { retryAfterMs: event.retryAfterMs }),
          });
        },
        onBackoff: (event) => {
          this.eventBus?.emit({
            type: 'provider.backoff',
            blockchain,
            provider: providerName,
            attemptNumber: event.attemptNumber,
            delayMs: event.delayMs,
          });
        },
      }),
    });
  }

  private emitCircuitOpenIfTriggered(
    blockchain: string,
    providerName: string,
    previousState: CircuitState,
    nextState: CircuitState,
    reason?: string
  ): void {
    const now = Date.now();
    const wasOpen = isCircuitOpen(previousState, now);
    const isOpenNow = isCircuitOpen(nextState, now);
    if (!wasOpen && isOpenNow) {
      this.eventBus?.emit({
        type: 'provider.circuit_open',
        blockchain,
        provider: providerName,
        reason: reason ?? 'failure_threshold_reached',
      });
    }
  }

  private recordProviderFailure(blockchain: string, providerName: string, errorMessage: string): void {
    const providerKey = getProviderKey(blockchain, providerName);
    const circuitState = this.circuitBreakers.getOrCreate(providerKey);
    const now = Date.now();
    const newCircuitState = this.circuitBreakers.recordFailure(providerKey, now);
    this.emitCircuitOpenIfTriggered(blockchain, providerName, circuitState, newCircuitState, errorMessage);
    this.statsStore.updateHealth(providerKey, false, 0, errorMessage);
  }

  /**
   * Execute operation with streaming pagination and intelligent failover
   */
  private async *executeStreamingImpl<T>(
    blockchain: string,
    operation: StreamingOperation,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>> {
    // Auto-register providers for this blockchain if not already registered
    const existingProviders = this.providers.get(blockchain);
    if (!existingProviders || existingProviders.length === 0) {
      this.autoRegisterFromConfig(blockchain);
    }

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

    const initialIds = resumeCursor ? [resumeCursor.lastTransactionId] : [];
    const deduplicationWindow = createDeduplicationWindow(initialIds);

    let lastErrorMessage: string | undefined;
    let lastFailedProvider: string | undefined;

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

      const isDifferentProvider = currentCursor ? currentCursor.metadata?.providerName !== provider.name : false;
      const isFailover = lastFailedProvider !== undefined && lastFailedProvider !== provider.name;

      // Use manager's cursor resolution for ALL cursor handling
      const adjustedCursor = resolveCursorStateForProvider(currentCursor, provider, isDifferentProvider, logger);

      // Log provider usage with context
      if (isFailover) {
        const cursorInfo = currentCursor
          ? ` (resuming from ${currentCursor.primary.type} ${currentCursor.primary.value})`
          : '';
        logger.info(
          `Using provider ${provider.name} for ${operation.type} (failover from ${lastFailedProvider}${cursorInfo})`
        );
      } else if (isDifferentProvider) {
        logger.info(
          `Using provider ${provider.name} for ${operation.type} (re-selected from ${currentCursor!.metadata?.providerName} based on current priority)`
        );
      } else if (currentCursor) {
        logger.info(`Using provider ${provider.name} for ${operation.type} (resuming same provider)`);
      } else {
        logger.debug(`Using provider ${provider.name} for ${operation.type}`);
      }

      // Emit all relevant events for this provider transition
      emitProviderTransition(this.eventBus, {
        blockchain,
        operation,
        currentProvider: provider,
        previousProvider: lastFailedProvider,
        currentCursor,
        adjustedCursor,
        failureReason: lastErrorMessage,
      });

      try {
        const iterator = provider.executeStreaming(operation, adjustedCursor);

        let providerFailed = false;
        for await (const batchResult of iterator) {
          if (batchResult.isErr()) {
            lastErrorMessage = getErrorMessage(batchResult.error);
            lastFailedProvider = provider.name;
            logger.error(`Provider ${provider.name} batch failed: ${lastErrorMessage}`);
            this.recordProviderFailure(blockchain, provider.name, lastErrorMessage);
            providerIndex++;
            providerFailed = true;
            break;
          }

          const batch = batchResult.value;

          // Deduplicate (especially important after failover with replay window)
          const fetchedCount = batch.data.length;
          const deduplicated = deduplicateTransactions(
            batch.data as { normalized: NormalizedTransactionBase }[],
            deduplicationWindow,
            DEFAULT_DEDUP_WINDOW_SIZE
          );
          const deduplicatedCount = fetchedCount - deduplicated.length;

          // Critical: Always yield completion batches, even with zero data after dedup
          if (deduplicated.length > 0 || batch.isComplete) {
            if (deduplicatedCount > 0) {
              logger.info(
                `Filtered ${deduplicatedCount} duplicate(s) via in-memory dedup (${deduplicated.length} yielded, ${fetchedCount} fetched)`
              );
            }

            yield ok({
              data: deduplicated as T[],
              providerName: provider.name,
              cursor: batch.cursor,
              isComplete: batch.isComplete,
              stats: {
                fetched: fetchedCount,
                deduplicated: deduplicatedCount,
                yielded: deduplicated.length,
              },
            });
          }

          currentCursor = batch.cursor;

          this.circuitBreakers.recordSuccess(getProviderKey(blockchain, provider.name), Date.now());
        }

        // If provider failed during streaming, continue to next provider
        if (providerFailed) {
          continue;
        }

        logger.debug(`Provider ${provider.name} completed successfully`);
        return;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        lastErrorMessage = errorMessage;
        lastFailedProvider = provider.name;
        logger.error(`Provider ${provider.name} failed with unexpected error: ${errorMessage}`);
        this.recordProviderFailure(blockchain, provider.name, errorMessage);
        providerIndex++;

        if (providerIndex < providers.length) {
          const nextProvider = providers[providerIndex];
          if (nextProvider) {
            logger.info(`Failing over to ${nextProvider.name}`);
          }
        } else {
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

    // No compatible providers found or all failed
    const reason = lastErrorMessage ? ` Last error: ${lastErrorMessage}` : '';
    yield err(
      new ProviderError(`No compatible providers found for ${blockchain}.${reason}`, 'NO_COMPATIBLE_PROVIDERS', {
        blockchain,
        operation: operation.type,
        lastError: lastErrorMessage,
      })
    );
  }

  /**
   * Execute operation with intelligent failover and caching
   */
  private async executeOneShotImpl<TOperation extends OneShotOperation>(
    blockchain: string,
    operation: TOperation
  ): Promise<Result<FailoverExecutionResult<OneShotOperationResult<TOperation>>, ProviderError>> {
    // Auto-register providers for this blockchain if not already registered
    const existingProviders = this.providers.get(blockchain);
    if (!existingProviders || existingProviders.length === 0) {
      this.autoRegisterFromConfig(blockchain);
    }

    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation);
      const cached =
        this.responseCache.get<Result<FailoverExecutionResult<OneShotOperationResult<TOperation>>, ProviderError>>(
          cacheKey
        );
      if (cached) {
        return cached;
      }
    }

    const result = await this.executeWithCircuitBreaker(blockchain, operation);

    // Cache result if cacheable
    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation);
      this.responseCache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Get providers ordered by preference for the given operation
   */
  private getProvidersInOrder(blockchain: string, operation: ProviderOperation): IBlockchainProvider[] {
    const candidates = this.providers.get(blockchain) || [];
    const now = Date.now();

    // Create blockchain-specific maps for this operation
    const healthMapForBlockchain = this.statsStore.getHealthMapForProviders(blockchain, candidates);
    const circuitMapForBlockchain = new Map<string, CircuitState>();

    for (const provider of candidates) {
      const providerKey = getProviderKey(blockchain, provider.name);
      const circuit = this.circuitBreakers.get(providerKey);
      if (circuit) circuitMapForBlockchain.set(provider.name, circuit);
    }

    const scoredProviders = selectProvidersForOperation(
      candidates,
      healthMapForBlockchain,
      circuitMapForBlockchain,
      operation,
      now
    );

    // Check if a preferred provider was specified for this blockchain
    const preferredProviderName = this.preferredProviders.get(blockchain);

    if (preferredProviderName) {
      const preferredProvider = scoredProviders.find((sp) => sp.provider.name === preferredProviderName);

      if (preferredProvider) {
        logger.debug(`Using preferred provider ${preferredProviderName} for ${operation.type} (supports operation)`);
        return [preferredProvider.provider];
      } else {
        logger.debug(
          `Preferred provider ${preferredProviderName} does not support ${operation.type} - using ${scoredProviders.length} available provider(s)`
        );
      }
    }

    // Log provider selection details
    if (scoredProviders.length > 1) {
      logger.debug(
        `Provider selection for ${operation.type} - Providers: ${buildProviderSelectionDebugInfo(scoredProviders)}`
      );
    }

    return scoredProviders.map((item) => item.provider);
  }

  /**
   * Execute with circuit breaker protection and automatic failover
   * Delegates to generic executeWithFailover from @exitbook/resilience
   */
  private async executeWithCircuitBreaker<TOperation extends OneShotOperation>(
    blockchain: string,
    operation: TOperation
  ): Promise<Result<FailoverExecutionResult<OneShotOperationResult<TOperation>>, ProviderError>> {
    const providers = this.getProvidersInOrder(blockchain, operation);

    return executeWithFailover<IBlockchainProvider, OneShotOperationResult<TOperation>, ProviderError>({
      providers,
      execute: (provider) => provider.execute(operation),
      circuitBreakers: this.circuitBreakers,
      operationLabel: `${blockchain}/${operation.type}`,
      logger,

      getCircuitKey: (provider) => getProviderKey(blockchain, provider.name),

      onSuccess: (provider, responseTime) => {
        this.statsStore.updateHealth(getProviderKey(blockchain, provider.name), true, responseTime);
      },

      onFailure: (provider, error, responseTime, previousCircuitState, newCircuitState) => {
        const providerKey = getProviderKey(blockchain, provider.name);
        this.emitCircuitOpenIfTriggered(
          blockchain,
          provider.name,
          previousCircuitState,
          newCircuitState,
          error.message
        );
        this.statsStore.updateHealth(providerKey, false, responseTime, error.message);
      },

      buildFinalError: (lastError, attemptedProviders) =>
        new ProviderError(
          attemptedProviders.length === 0
            ? `No providers available for ${blockchain} operation: ${operation.type}`
            : `All providers failed for ${blockchain} operation: ${operation.type}. Last error: ${lastError?.message}`,
          attemptedProviders.length === 0 ? 'NO_PROVIDERS' : 'ALL_PROVIDERS_FAILED',
          {
            blockchain,
            ...(lastError?.message && { lastError: lastError.message }),
            operation: operation.type,
          }
        ),
    });
  }
}

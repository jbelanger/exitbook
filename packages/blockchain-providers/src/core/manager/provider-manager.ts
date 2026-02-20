import { getErrorMessage, type CursorState } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import {
  CircuitBreakerRegistry,
  isCircuitHalfOpen,
  isCircuitOpen,
  type CircuitState,
  type CircuitStatus,
} from '@exitbook/resilience/circuit-breaker';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderEvent } from '../../events.js';
import type { ProviderStatsQueries } from '../../persistence/queries/provider-stats-queries.js';
import { ProviderResponseCache } from '../cache/provider-response-cache.js';
import { ProviderInstanceFactory } from '../factory/provider-instance-factory.js';
import { ProviderHealthMonitor } from '../health/provider-health-monitor.js';
import { getProviderKey } from '../health/provider-stats-store.js';
import { ProviderStatsStore } from '../health/provider-stats-store.js';
import type { NormalizedTransactionBase } from '../index.js';
import { ProviderError } from '../types/errors.js';
import type {
  FailoverExecutionResult,
  FailoverStreamingExecutionResult,
  IBlockchainProvider,
  ProviderHealth,
  OneShotOperation,
  ProviderOperation,
  StreamingOperation,
} from '../types/index.js';
import type { BlockchainExplorersConfig } from '../utils/config-utils.js';

import { emitProviderTransition } from './provider-manager-events.js';
import {
  buildProviderSelectionDebugInfo,
  canProviderResume,
  createDeduplicationWindow,
  DEFAULT_DEDUP_WINDOW_SIZE,
  deduplicateTransactions,
  hasAvailableProviders,
  resolveCursorStateForProvider,
  selectProvidersForOperation,
} from './provider-manager-utils.js';

const logger = getLogger('BlockchainProviderManager');

export class BlockchainProviderManager {
  private readonly circuitBreakers = new CircuitBreakerRegistry();
  private readonly statsStore = new ProviderStatsStore();
  private readonly responseCache = new ProviderResponseCache();
  private readonly healthMonitor: ProviderHealthMonitor;
  private readonly instanceFactory: ProviderInstanceFactory;

  private instrumentation?: InstrumentationCollector | undefined;
  private eventBus?: EventBus<ProviderEvent> | undefined;
  private providers = new Map<string, IBlockchainProvider[]>();
  private preferredProviders = new Map<string, string>(); // blockchain -> preferred provider name

  constructor(explorerConfig?: BlockchainExplorersConfig) {
    this.instanceFactory = new ProviderInstanceFactory(explorerConfig);
    this.healthMonitor = new ProviderHealthMonitor(
      () => this.providers,
      (blockchain, providerName, success, responseTime, error) => {
        this.statsStore.updateHealth(getProviderKey(blockchain, providerName), success, responseTime, error);
      }
    );
    // Wire factory context immediately so providers created before setEventBus/setInstrumentation
    // still get request hooks (handlers close over this.eventBus / this.instrumentation at call time).
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

    const closePromises: Promise<PromiseSettledResult<void>>[] = [];

    for (const providerList of this.providers.values()) {
      for (const provider of providerList) {
        closePromises.push(
          Promise.resolve(provider.destroy()).then(
            () => ({ status: 'fulfilled' as const, value: undefined }),
            (error: unknown) => ({ status: 'rejected' as const, reason: error })
          )
        );
      }
    }

    const results = await Promise.all(closePromises);
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
    if (operation.type === 'getAddressTransactions') {
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
      yield ok(this.wrapOneShotResult(result.value));
    }
  }

  /**
   * Helper method for one-shot operations - consumes first yielded result
   *
   * Use this for operations that always yield exactly once (getBalance, getTokenMetadata, hasAddressTransactions, etc.).
   * For transaction fetching operations that may yield multiple batches, use executeWithFailover directly.
   */
  async executeWithFailoverOnce<T>(
    blockchain: string,
    operation: OneShotOperation
  ): Promise<Result<FailoverExecutionResult<T>, Error>> {
    // Runtime guard in case typing is bypassed
    if ((operation as ProviderOperation).type === 'getAddressTransactions') {
      return err(
        new Error(
          `executeWithFailoverOnce is only for one-shot operations; received streaming operation: ${(operation as ProviderOperation).type}`
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
    return this.providers.get(blockchain) || [];
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
   * Set instrumentation collector for tracking API calls.
   * This will be passed to all providers for HTTP request tracking.
   */
  setInstrumentation(collector: InstrumentationCollector): void {
    this.instrumentation = collector;
    this.syncFactoryContext();
  }

  /**
   * Set event bus for emitting provider events.
   * Used for CLI progress display and observability.
   */
  setEventBus(eventBus: EventBus<ProviderEvent>): void {
    this.eventBus = eventBus;
    this.syncFactoryContext();
  }

  /**
   * Set stats queries for persisting provider health across runs
   */
  setStatsQueries(queries: ProviderStatsQueries): void {
    this.statsStore.setQueries(queries);
  }

  /**
   * Load persisted provider stats from the database.
   * Must be called after setStatsQueries() and before providers are registered
   * so that registerProviders() sees existing health/circuit data and skips re-initialization.
   */
  async loadPersistedStats(): Promise<void> {
    await this.statsStore.load(this.circuitBreakers);
  }

  /**
   * Rebuild the factory context from current manager state.
   * Called whenever instrumentation or eventBus changes.
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
        reason: reason || 'failure_threshold_reached',
      });
    }
  }

  /**
   * Execute operation with streaming pagination and intelligent failover
   */
  private async *executeStreamingImpl<T>(
    blockchain: string,
    operation: StreamingOperation,
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

            // Record failure and try next provider
            const providerKey = getProviderKey(blockchain, provider.name);
            const circuitState = this.circuitBreakers.getOrCreate(providerKey);
            const now = Date.now();
            const newCircuitState = this.circuitBreakers.recordFailure(providerKey, now);
            this.emitCircuitOpenIfTriggered(blockchain, provider.name, circuitState, newCircuitState, lastErrorMessage);
            this.statsStore.updateHealth(providerKey, false, 0, getErrorMessage(batchResult.error));

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

          // Record success for circuit breaker
          const providerKey = getProviderKey(blockchain, provider.name);
          this.circuitBreakers.recordSuccess(providerKey, Date.now());
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

        // Record failure
        const providerKey = getProviderKey(blockchain, provider.name);
        const circuitState = this.circuitBreakers.getOrCreate(providerKey);
        const now = Date.now();
        const newCircuitState = this.circuitBreakers.recordFailure(providerKey, now);
        this.emitCircuitOpenIfTriggered(blockchain, provider.name, circuitState, newCircuitState, errorMessage);
        this.statsStore.updateHealth(providerKey, false, 0, errorMessage);

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
      const cached = this.responseCache.get<Result<FailoverExecutionResult<T>, ProviderError>>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const result = (await this.executeWithCircuitBreaker(blockchain, operation)) as unknown as Result<
      FailoverExecutionResult<T>,
      ProviderError
    >;

    // Cache result if cacheable
    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation);
      this.responseCache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Execute with circuit breaker protection and automatic failover
   */
  private async executeWithCircuitBreaker<T>(
    blockchain: string,
    operation: OneShotOperation
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
      const providerKey = getProviderKey(blockchain, provider.name);
      const circuitState = this.circuitBreakers.getOrCreate(providerKey);

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
      if (circuitIsOpen) {
        const circuitMapForBlockchain = new Map<string, CircuitState>();
        for (const p of providers) {
          const pKey = getProviderKey(blockchain, p.name);
          const circuit = this.circuitBreakers.get(pKey);
          if (circuit) circuitMapForBlockchain.set(p.name, circuit);
        }

        if (hasAvailableProviders(providers, circuitMapForBlockchain, now)) {
          logger.debug(`Skipping provider ${provider.name} - circuit breaker is open`);
          continue;
        }
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
        const result = await provider.execute<T>(operation);

        // Unwrap Result type - throw error to trigger failover
        if (result.isErr()) {
          throw result.error;
        }

        const responseTime = Date.now() - startTime;

        // Record success
        this.circuitBreakers.recordSuccess(providerKey, Date.now());
        this.statsStore.updateHealth(providerKey, true, responseTime);

        return ok({
          data: result.value,
          providerName: provider.name,
        });
      } catch (error) {
        lastError = error as Error;
        const responseTime = Date.now() - startTime;

        if (attemptNumber < providers.length) {
          logger.warn(`Provider ${provider.name} failed, trying next provider: ${getErrorMessage(error)}`);
        } else {
          logger.error(`All providers failed for ${operation.type}: ${getErrorMessage(error)}`);
        }

        // Record failure
        const failNow = Date.now();
        const newCircuitState = this.circuitBreakers.recordFailure(providerKey, failNow);
        this.emitCircuitOpenIfTriggered(blockchain, provider.name, circuitState, newCircuitState, lastError.message);
        this.statsStore.updateHealth(providerKey, false, responseTime, lastError.message);

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
   * Wrap a one-shot execution result into a streaming batch format
   */
  private wrapOneShotResult<T>(result: FailoverExecutionResult<T>): FailoverStreamingExecutionResult<T> {
    return {
      data: [result.data] as T[],
      providerName: result.providerName,
      cursor: {
        primary: { type: 'blockNumber' as const, value: 0 },
        lastTransactionId: '',
        totalFetched: 1,
        metadata: {
          providerName: result.providerName,
          updatedAt: Date.now(),
        },
      },
      isComplete: true,
      stats: {
        fetched: 1,
        deduplicated: 0,
        yielded: 1,
      },
    };
  }
}

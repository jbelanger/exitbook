import { getErrorMessage, type CursorState } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import { TtlCache } from '@exitbook/resilience/cache';
import { CircuitBreakerRegistry, isCircuitOpen, type CircuitState } from '@exitbook/resilience/circuit-breaker';
import { executeWithFailover } from '@exitbook/resilience/failover';
import { buildProviderSelectionDebugInfo } from '@exitbook/resilience/provider-selection';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderEvent } from '../../events.js';
import { getProviderKey, type ProviderStatsStore } from '../health/provider-stats-store.js';
import type { NormalizedTransactionBase } from '../index.js';
import { ProviderError } from '../types/errors.js';
import type {
  FailoverExecutionResult,
  FailoverStreamingExecutionResult,
  IBlockchainProvider,
  OneShotOperation,
  OneShotOperationResult,
  ProviderOperation,
  StreamingOperation,
} from '../types/index.js';

import { emitProviderTransition } from './provider-manager-events.js';
import {
  canProviderResume,
  createDeduplicationWindow,
  DEFAULT_DEDUP_WINDOW_SIZE,
  deduplicateTransactions,
  resolveCursorStateForProvider,
  selectProvidersForOperation,
} from './provider-manager-utils.js';

const logger = getLogger('ProviderFailoverEngine');

/**
 * Internal engine that owns all failover/execution orchestration logic.
 * Not exported from the package — only used by BlockchainProviderManager.
 */
export class ProviderFailoverEngine {
  constructor(
    private readonly providers: Map<string, IBlockchainProvider[]>,
    private readonly circuitBreakers: CircuitBreakerRegistry,
    private readonly statsStore: ProviderStatsStore,
    private readonly responseCache: TtlCache,
    private readonly preferredProviders: Map<string, string>,
    private readonly eventBus: EventBus<ProviderEvent> | undefined,
    private readonly autoRegisterFromConfig: (blockchain: string) => void
  ) {}

  async *executeStreamingImpl<T>(
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

    const operationDesc = operation.streamType ? `${operation.type}[${operation.streamType}]` : operation.type;

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
            logger.error(`Provider ${provider.name} batch failed (${operationDesc}): ${lastErrorMessage}`);
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
              `All providers exhausted for ${blockchain} (${operationDesc}). Last error: ${errorMessage}`,
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
      new ProviderError(
        `No compatible providers found for ${blockchain} (${operationDesc}).${reason}`,
        'NO_COMPATIBLE_PROVIDERS',
        {
          blockchain,
          operation: operation.type,
          lastError: lastErrorMessage,
        }
      )
    );
  }

  async executeOneShotImpl<TOperation extends OneShotOperation>(
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
}

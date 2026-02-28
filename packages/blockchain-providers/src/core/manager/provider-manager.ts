import { getErrorMessage, type CursorState, type TokenMetadataRecord } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';
import { TtlCache } from '@exitbook/resilience/cache';
import { CircuitBreakerRegistry, type CircuitStatus } from '@exitbook/resilience/circuit-breaker';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { ProviderEvent } from '../../events.js';
import type { ProviderStatsQueries } from '../../persistence/queries/provider-stats-queries.js';
import type { TokenMetadataQueries } from '../../persistence/token-metadata/queries.js';
import { ProviderInstanceFactory } from '../factory/provider-instance-factory.js';
import { ProviderHealthMonitor } from '../health/provider-health-monitor.js';
import { getProviderKey, ProviderStatsStore, type ProviderStatsStoreOptions } from '../health/provider-stats-store.js';
import type { ProviderRegistry } from '../registry/provider-registry.js';
import { TokenMetadataCache } from '../token-metadata/token-metadata-cache.js';
import type {
  AddressInfoData,
  FailoverExecutionResult,
  FailoverStreamingExecutionResult,
  IBlockchainProvider,
  ProviderHealth,
  RawBalanceData,
} from '../types/index.js';
import type { BlockchainExplorersConfig } from '../utils/config-utils.js';

import { ProviderFailoverEngine } from './provider-failover-engine.js';

const logger = getLogger('BlockchainProviderManager');

export interface BlockchainProviderManagerOptions {
  explorerConfig?: BlockchainExplorersConfig | undefined;
  statsStore?: ProviderStatsStoreOptions | undefined;
  instrumentation?: InstrumentationCollector | undefined;
  eventBus?: EventBus<ProviderEvent> | undefined;
  statsQueries?: ProviderStatsQueries | undefined;
  tokenMetadataQueries?: TokenMetadataQueries | undefined;
}

export class BlockchainProviderManager {
  private readonly circuitBreakers = new CircuitBreakerRegistry();
  private readonly statsStore: ProviderStatsStore;
  private readonly responseCache = new TtlCache();
  private readonly healthMonitor: ProviderHealthMonitor;
  private readonly instanceFactory: ProviderInstanceFactory;
  private readonly engine: ProviderFailoverEngine;

  private instrumentation?: InstrumentationCollector | undefined;
  private eventBus?: EventBus<ProviderEvent> | undefined;
  private providers = new Map<string, IBlockchainProvider[]>();
  private preferredProviders = new Map<string, string>(); // blockchain -> preferred provider name
  private readonly tokenMetadataCache?: TokenMetadataCache | undefined;

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

    this.engine = new ProviderFailoverEngine(
      this.providers,
      this.circuitBreakers,
      this.statsStore,
      this.responseCache,
      this.preferredProviders,
      this.eventBus,
      (blockchain: string) => this.autoRegisterFromConfig(blockchain)
    );

    if (options?.tokenMetadataQueries) {
      this.tokenMetadataCache = new TokenMetadataCache(
        options.tokenMetadataQueries,
        (blockchain, addresses) =>
          this.engine.executeOneShotImpl(blockchain, {
            type: 'getTokenMetadata',
            contractAddresses: addresses,
          }),
        this.eventBus
      );
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

  // ─── Typed public API ──────────────────────────────────────────────

  async *streamAddressTransactions<T>(
    blockchain: string,
    address: string,
    options?: {
      contractAddress?: string | undefined;
      streamType?: string | undefined;
    },
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>> {
    yield* this.engine.executeStreamingImpl<T>(
      blockchain,
      {
        type: 'getAddressTransactions',
        address,
        streamType: options?.streamType,
        contractAddress: options?.contractAddress,
      },
      resumeCursor
    );
  }

  async getAddressBalances(
    blockchain: string,
    address: string,
    contractAddresses?: string[]
  ): Promise<Result<FailoverExecutionResult<RawBalanceData>, Error>> {
    return this.engine.executeOneShotImpl(blockchain, {
      type: 'getAddressBalances',
      address,
      contractAddresses,
    });
  }

  async getAddressTokenBalances(
    blockchain: string,
    address: string,
    contractAddresses?: string[]
  ): Promise<Result<FailoverExecutionResult<RawBalanceData[]>, Error>> {
    return this.engine.executeOneShotImpl(blockchain, {
      type: 'getAddressTokenBalances',
      address,
      contractAddresses,
    });
  }

  async getTokenMetadata(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>> {
    if (this.tokenMetadataCache) {
      return this.tokenMetadataCache.getBatch(blockchain, contractAddresses);
    }

    // No cache — raw fetch, wrap into map
    const result = await this.engine.executeOneShotImpl(blockchain, {
      type: 'getTokenMetadata',
      contractAddresses,
    });
    if (result.isErr()) {
      // Treat NO_PROVIDERS the same as the cache path: return an all-undefined map
      if (result.error.code === 'NO_PROVIDERS') {
        const map = new Map<string, TokenMetadataRecord | undefined>();
        for (const addr of contractAddresses) map.set(addr, undefined);
        return ok(map);
      }
      return err(result.error);
    }

    const map = new Map<string, TokenMetadataRecord | undefined>();
    for (const meta of result.value.data) {
      map.set(meta.contractAddress, {
        ...meta,
        blockchain,
        source: result.value.providerName,
        refreshedAt: new Date(),
      });
    }
    // Mark addresses not returned by the provider as undefined
    for (const addr of contractAddresses) {
      if (!map.has(addr)) {
        map.set(addr, undefined);
      }
    }
    return ok(map);
  }

  async hasAddressTransactions(
    blockchain: string,
    address: string
  ): Promise<Result<FailoverExecutionResult<boolean>, Error>> {
    return this.engine.executeOneShotImpl(blockchain, {
      type: 'hasAddressTransactions',
      address,
      getCacheKey: () => `${blockchain}:has-txs:${address}`,
    });
  }

  async getAddressInfo(
    blockchain: string,
    address: string
  ): Promise<Result<FailoverExecutionResult<AddressInfoData>, Error>> {
    return this.engine.executeOneShotImpl(blockchain, {
      type: 'getAddressInfo',
      address,
      getCacheKey: () => `getAddressInfo:${blockchain}:${address}`,
    });
  }

  // ─── Provider health & registration ────────────────────────────────

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
}

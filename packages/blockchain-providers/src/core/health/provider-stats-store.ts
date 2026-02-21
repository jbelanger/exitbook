/**
 * Store for provider health metrics and lifetime counters with SQLite persistence
 *
 * Wraps ProviderHealthStore from @exitbook/resilience for in-memory state,
 * adding blockchain-specific composite keys and SQLite load/save.
 */

import { getLogger } from '@exitbook/logger';
import type { CircuitBreakerRegistry, CircuitState, CircuitStatus } from '@exitbook/resilience/circuit-breaker';
import type { ProviderHealth } from '@exitbook/resilience/provider-health';
import { ProviderHealthStore } from '@exitbook/resilience/provider-stats';

import { hydrateProviderStats } from '../../persistence/provider-stats-utils.js';
import type { ProviderStatsQueries } from '../../persistence/queries/provider-stats-queries.js';

const logger = getLogger('ProviderStatsStore');

/** Branded composite key (`blockchain/providerName`) produced by {@link getProviderKey}. */
export type ProviderKey = string & { readonly __brand: 'ProviderKey' };

/**
 * Create composite key for provider stats to prevent collisions when same provider
 * name is used across multiple blockchains (e.g., tatum for bitcoin, litecoin, etc.)
 */
export function getProviderKey(blockchain: string, providerName: string): ProviderKey {
  return `${blockchain}/${providerName}` as ProviderKey;
}

/**
 * Parse composite key back into blockchain and provider name
 */
export function parseProviderKey(key: ProviderKey): { blockchain: string; providerName: string } {
  const [blockchain, providerName] = key.split('/');
  if (!blockchain || !providerName) {
    throw new Error(`Invalid provider key format: ${key}`);
  }
  return { blockchain, providerName };
}

export interface ProviderStatsStoreOptions {
  /** Recovery timeout for stale circuit breaker state on load (default: 30s for CLI-style fresh starts) */
  circuitRecoveryTimeoutMs?: number | undefined;
}

/** CLI-friendly default: circuits from prior runs recover quickly */
const DEFAULT_CIRCUIT_RECOVERY_TIMEOUT_MS = 30_000;

export class ProviderStatsStore {
  private readonly store = new ProviderHealthStore();
  private statsQueries?: ProviderStatsQueries | undefined;
  private readonly circuitRecoveryTimeoutMs: number;

  constructor(options?: ProviderStatsStoreOptions) {
    this.circuitRecoveryTimeoutMs = options?.circuitRecoveryTimeoutMs ?? DEFAULT_CIRCUIT_RECOVERY_TIMEOUT_MS;
  }

  initializeProvider(key: ProviderKey): void {
    this.store.initializeProvider(key);
  }

  getHealth(key: ProviderKey): ProviderHealth | undefined {
    return this.store.getHealth(key);
  }

  hasHealth(key: ProviderKey): boolean {
    return this.store.hasHealth(key);
  }

  updateHealth(key: ProviderKey, success: boolean, responseTime: number, errorMessage?: string): void {
    this.store.updateHealth(key, success, responseTime, errorMessage);
  }

  getProviderHealthWithCircuit(
    key: ProviderKey,
    circuitState: CircuitState,
    now: number
  ): (ProviderHealth & { circuitState: CircuitStatus }) | undefined {
    return this.store.getProviderHealthWithCircuit(key, circuitState, now);
  }

  /** Build blockchain-specific health map keyed by provider.name (not composite key) */
  getHealthMapForProviders(blockchain: string, providers: { name: string }[]): Map<string, ProviderHealth> {
    return this.store.getHealthMapForKeys(
      providers.map((p) => ({ key: getProviderKey(blockchain, p.name), mapAs: p.name }))
    );
  }

  setQueries(queries: ProviderStatsQueries): void {
    this.statsQueries = queries;
  }

  async load(circuitRegistry: CircuitBreakerRegistry): Promise<void> {
    if (!this.statsQueries) return;

    const result = await this.statsQueries.getAll();
    if (result.isErr()) {
      logger.warn(`Failed to load persisted provider stats: ${result.error.message}`);
      return;
    }

    const rows = result.value;
    if (rows.length === 0) return;

    const now = Date.now();

    for (const row of rows) {
      const hydrated = hydrateProviderStats(row, now, this.circuitRecoveryTimeoutMs);
      const providerKey = getProviderKey(hydrated.blockchain, hydrated.providerName);
      this.store.load(providerKey, hydrated.health, hydrated.totalSuccesses, hydrated.totalFailures);
      circuitRegistry.set(providerKey, hydrated.circuitState);
    }

    logger.info(`Loaded persisted stats for ${rows.length} provider(s)`);
  }

  async save(circuitRegistry: CircuitBreakerRegistry): Promise<void> {
    if (!this.statsQueries) return;

    for (const snapshot of this.store.getSnapshots()) {
      const { blockchain, providerName } = parseProviderKey(snapshot.key as ProviderKey);

      const circuitState = circuitRegistry.get(snapshot.key);
      if (!circuitState) continue;

      const result = await this.statsQueries.upsert({
        blockchain,
        providerName,
        avgResponseTime: snapshot.health.averageResponseTime,
        errorRate: snapshot.health.errorRate,
        consecutiveFailures: snapshot.health.consecutiveFailures,
        isHealthy: snapshot.health.isHealthy,
        lastError: snapshot.health.lastError,
        lastChecked: snapshot.health.lastChecked,
        failureCount: circuitState.failureCount,
        lastFailureTime: circuitState.lastFailureTime,
        lastSuccessTime: circuitState.lastSuccessTime,
        totalSuccesses: snapshot.totalSuccesses,
        totalFailures: snapshot.totalFailures,
      });

      if (result.isErr()) {
        logger.warn(`Failed to save stats for ${blockchain}/${providerName}: ${result.error.message}`);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

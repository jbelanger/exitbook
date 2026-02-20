/**
 * Store for provider health metrics and lifetime counters
 *
 * Owns the healthStatus, totalSuccesses, and totalFailures maps that were
 * previously embedded in BlockchainProviderManager. Also handles SQLite
 * persistence via ProviderStatsQueries.
 */

import { getLogger } from '@exitbook/logger';
import type { CircuitBreakerRegistry, CircuitState, CircuitStatus } from '@exitbook/resilience/circuit-breaker';

import { hydrateProviderStats } from '../../persistence/provider-stats-utils.js';
import type { ProviderStatsQueries } from '../../persistence/queries/provider-stats-queries.js';
import {
  createInitialHealth,
  getProviderHealthWithCircuit,
  updateHealthMetrics,
} from '../manager/provider-manager-utils.js';
import type { ProviderHealth } from '../types/index.js';

const logger = getLogger('ProviderStatsStore');

/**
 * Create composite key for provider stats to prevent collisions when same provider
 * name is used across multiple blockchains (e.g., tatum for bitcoin, litecoin, etc.)
 */
export function getProviderKey(blockchain: string, providerName: string): string {
  return `${blockchain}/${providerName}`;
}

/**
 * Parse composite key back into blockchain and provider name
 */
export function parseProviderKey(key: string): { blockchain: string; providerName: string } {
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
  private healthStatus = new Map<string, ProviderHealth>();
  private totalSuccesses = new Map<string, number>();
  private totalFailures = new Map<string, number>();
  private statsQueries?: ProviderStatsQueries | undefined;
  private readonly circuitRecoveryTimeoutMs: number;

  constructor(options?: ProviderStatsStoreOptions) {
    this.circuitRecoveryTimeoutMs = options?.circuitRecoveryTimeoutMs ?? DEFAULT_CIRCUIT_RECOVERY_TIMEOUT_MS;
  }

  initializeProvider(key: string): void {
    if (!this.healthStatus.has(key)) {
      this.healthStatus.set(key, createInitialHealth());
    }
    if (!this.totalSuccesses.has(key)) {
      this.totalSuccesses.set(key, 0);
    }
    if (!this.totalFailures.has(key)) {
      this.totalFailures.set(key, 0);
    }
  }

  getHealth(key: string): ProviderHealth | undefined {
    return this.healthStatus.get(key);
  }

  hasHealth(key: string): boolean {
    return this.healthStatus.has(key);
  }

  updateHealth(key: string, success: boolean, responseTime: number, errorMessage?: string): void {
    const currentHealth = this.healthStatus.get(key);
    if (currentHealth) {
      const updatedHealth = updateHealthMetrics(currentHealth, success, responseTime, Date.now(), errorMessage);
      this.healthStatus.set(key, updatedHealth);
    } else {
      logger.warn(`updateHealth called for uninitialized provider key: ${key} — call initializeProvider first`);
    }

    if (success) {
      this.totalSuccesses.set(key, (this.totalSuccesses.get(key) ?? 0) + 1);
    } else {
      this.totalFailures.set(key, (this.totalFailures.get(key) ?? 0) + 1);
    }
  }

  getProviderHealthWithCircuit(
    key: string,
    circuitState: CircuitState,
    now: number
  ): (ProviderHealth & { circuitState: CircuitStatus }) | undefined {
    const health = this.healthStatus.get(key);
    if (!health) return undefined;
    return getProviderHealthWithCircuit(health, circuitState, now);
  }

  /** Build blockchain-specific health map keyed by provider.name (not composite key) */
  getHealthMapForProviders(blockchain: string, providers: { name: string }[]): Map<string, ProviderHealth> {
    const map = new Map<string, ProviderHealth>();
    for (const provider of providers) {
      const key = getProviderKey(blockchain, provider.name);
      const health = this.healthStatus.get(key);
      if (health) map.set(provider.name, health);
    }
    return map;
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
      this.healthStatus.set(providerKey, hydrated.health);
      circuitRegistry.set(providerKey, hydrated.circuitState);
      this.totalSuccesses.set(providerKey, hydrated.totalSuccesses);
      this.totalFailures.set(providerKey, hydrated.totalFailures);
    }

    logger.info(`Loaded persisted stats for ${rows.length} provider(s)`);
  }

  async save(circuitRegistry: CircuitBreakerRegistry): Promise<void> {
    if (!this.statsQueries) return;

    for (const [providerKey, health] of this.healthStatus) {
      const { blockchain, providerName } = parseProviderKey(providerKey);

      const circuitState = circuitRegistry.get(providerKey);
      if (!circuitState) continue;

      const result = await this.statsQueries.upsert({
        blockchain,
        providerName,
        avgResponseTime: health.averageResponseTime,
        errorRate: health.errorRate,
        consecutiveFailures: health.consecutiveFailures,
        isHealthy: health.isHealthy,
        lastError: health.lastError,
        lastChecked: health.lastChecked,
        failureCount: circuitState.failureCount,
        lastFailureTime: circuitState.lastFailureTime,
        lastSuccessTime: circuitState.lastSuccessTime,
        totalSuccesses: this.totalSuccesses.get(providerKey) ?? 0,
        totalFailures: this.totalFailures.get(providerKey) ?? 0,
      });

      if (result.isErr()) {
        logger.warn(`Failed to save stats for ${blockchain}/${providerName}: ${result.error.message}`);
      }
    }
  }

  clear(): void {
    this.healthStatus.clear();
    this.totalSuccesses.clear();
    this.totalFailures.clear();
  }
}

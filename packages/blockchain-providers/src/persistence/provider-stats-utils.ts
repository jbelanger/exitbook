/**
 * Pure functions for converting between DB rows and in-memory provider state
 */

import type { CircuitState } from '@exitbook/utils/circuit-breaker';

import type { ProviderHealth } from '../core/types/index.js';

export interface ProviderStatsRow {
  blockchain: string;
  provider_name: string;

  avg_response_time: number;
  error_rate: number;
  consecutive_failures: number;
  is_healthy: number; // SQLite boolean (0/1)
  last_error: string | null;
  last_checked: number; // epoch ms

  failure_count: number;
  last_failure_time: number; // epoch ms
  last_success_time: number; // epoch ms

  total_successes: number;
  total_failures: number;
}

export interface HydratedProviderStats {
  blockchain: string;
  providerName: string;
  health: ProviderHealth;
  circuitState: CircuitState;
  totalSuccesses: number;
  totalFailures: number;
}

/**
 * Default recovery timeout used by createInitialCircuitState (5 min)
 */
const DEFAULT_RECOVERY_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_FAILURES = 3;

/**
 * Hydrate a DB row into in-memory ProviderHealth + CircuitState.
 *
 * Stale-state handling: if `now - lastFailureTime >= recoveryTimeoutMs`,
 * reset circuit to closed. Health stats (averageResponseTime, errorRate)
 * are always preserved — they're the long-term value.
 */
export function hydrateProviderStats(
  row: ProviderStatsRow,
  now: number,
  recoveryTimeoutMs = DEFAULT_RECOVERY_TIMEOUT_MS
): HydratedProviderStats {
  const circuitIsStale =
    row.failure_count > 0 && row.last_failure_time > 0 && now - row.last_failure_time >= recoveryTimeoutMs;

  const health: ProviderHealth = {
    averageResponseTime: row.avg_response_time,
    errorRate: row.error_rate,
    consecutiveFailures: circuitIsStale ? 0 : row.consecutive_failures,
    isHealthy: circuitIsStale ? true : row.is_healthy === 1,
    lastChecked: row.last_checked,
    ...(row.last_error !== null && { lastError: row.last_error }),
  };

  const circuitState: CircuitState = {
    failureCount: circuitIsStale ? 0 : row.failure_count,
    lastFailureTime: row.last_failure_time,
    lastSuccessTime: row.last_success_time,
    maxFailures: DEFAULT_MAX_FAILURES,
    recoveryTimeoutMs,
  };

  return {
    blockchain: row.blockchain,
    providerName: row.provider_name,
    health,
    circuitState,
    totalSuccesses: row.total_successes,
    totalFailures: row.total_failures,
  };
}

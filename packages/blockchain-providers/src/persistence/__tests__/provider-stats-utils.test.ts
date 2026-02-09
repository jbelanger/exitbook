/* eslint-disable unicorn/no-null -- required for db */
import { describe, expect, it } from 'vitest';

import { hydrateProviderStats, type ProviderStatsRow } from '../provider-stats-utils.js';

function makeRow(overrides: Partial<ProviderStatsRow> = {}): ProviderStatsRow {
  return {
    blockchain: 'ethereum',
    provider_name: 'alchemy',
    avg_response_time: 250,
    error_rate: 0.05,
    consecutive_failures: 0,
    is_healthy: 1,
    last_error: null,
    last_checked: 1000,
    failure_count: 0,
    last_failure_time: 0,
    last_success_time: 500,
    total_successes: 100,
    total_failures: 5,
    ...overrides,
  };
}

describe('hydrateProviderStats', () => {
  it('hydrates a healthy row into ProviderHealth + CircuitState', () => {
    const row = makeRow();
    const result = hydrateProviderStats(row, 2000);

    expect(result.blockchain).toBe('ethereum');
    expect(result.providerName).toBe('alchemy');
    expect(result.health).toEqual({
      averageResponseTime: 250,
      errorRate: 0.05,
      consecutiveFailures: 0,
      isHealthy: true,
      lastChecked: 1000,
    });
    expect(result.circuitState).toEqual({
      failureCount: 0,
      lastFailureTime: 0,
      lastSuccessTime: 500,
      maxFailures: 3,
      recoveryTimeoutMs: 300_000,
    });
    expect(result.totalSuccesses).toBe(100);
    expect(result.totalFailures).toBe(5);
  });

  it('preserves unhealthy state when circuit is not stale', () => {
    const now = 10_000;
    const row = makeRow({
      is_healthy: 0,
      consecutive_failures: 3,
      failure_count: 3,
      last_failure_time: now - 1000, // 1s ago — well within recovery timeout
      last_error: 'timeout',
    });

    const result = hydrateProviderStats(row, now);

    expect(result.health.isHealthy).toBe(false);
    expect(result.health.consecutiveFailures).toBe(3);
    expect(result.health.lastError).toBe('timeout');
    expect(result.circuitState.failureCount).toBe(3);
  });

  it('resets circuit to closed when stale (past recovery timeout)', () => {
    const recoveryTimeout = 300_000; // 5 min
    const lastFailure = 1_000_000;
    const now = lastFailure + recoveryTimeout; // exactly at threshold

    const row = makeRow({
      is_healthy: 0,
      consecutive_failures: 5,
      failure_count: 5,
      last_failure_time: lastFailure,
      last_error: 'server error',
      avg_response_time: 3000,
      error_rate: 0.8,
    });

    const result = hydrateProviderStats(row, now, recoveryTimeout);

    // Circuit reset
    expect(result.circuitState.failureCount).toBe(0);
    expect(result.health.consecutiveFailures).toBe(0);
    expect(result.health.isHealthy).toBe(true);

    // Health stats preserved
    expect(result.health.averageResponseTime).toBe(3000);
    expect(result.health.errorRate).toBe(0.8);

    // Timestamps preserved
    expect(result.circuitState.lastFailureTime).toBe(lastFailure);
    expect(result.health.lastError).toBe('server error');
  });

  it('does not reset circuit when failure_count is 0 even if lastFailureTime is old', () => {
    const row = makeRow({
      failure_count: 0,
      last_failure_time: 1, // very old but failure_count already 0
      is_healthy: 1,
      consecutive_failures: 0,
    });

    const result = hydrateProviderStats(row, 999_999_999);

    expect(result.circuitState.failureCount).toBe(0);
    expect(result.health.isHealthy).toBe(true);
  });

  it('omits lastError from health when last_error is null', () => {
    const row = makeRow({ last_error: null });
    const result = hydrateProviderStats(row, 2000);

    expect(result.health.lastError).toBeUndefined();
    expect('lastError' in result.health).toBe(false);
  });

  it('uses custom recoveryTimeoutMs when provided', () => {
    const customTimeout = 10_000; // 10s
    const lastFailure = 5000;
    const now = lastFailure + customTimeout; // exactly at threshold

    const row = makeRow({
      is_healthy: 0,
      consecutive_failures: 2,
      failure_count: 2,
      last_failure_time: lastFailure,
    });

    const result = hydrateProviderStats(row, now, customTimeout);

    // Should be reset with custom timeout
    expect(result.circuitState.failureCount).toBe(0);
    expect(result.health.isHealthy).toBe(true);
    expect(result.circuitState.recoveryTimeoutMs).toBe(customTimeout);
  });
});

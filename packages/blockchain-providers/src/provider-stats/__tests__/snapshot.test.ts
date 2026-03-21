import { describe, expect, it } from 'vitest';

import type { ProviderStatsRow } from '../persistence/utils.js';
import { toProviderStatsSnapshot } from '../snapshot.js';

function makeRow(overrides: Partial<ProviderStatsRow> = {}): ProviderStatsRow {
  return {
    blockchain: 'ethereum',
    provider_name: 'alchemy',
    avg_response_time: 150,
    error_rate: 0.25,
    consecutive_failures: 2,
    is_healthy: 0,
    last_error: 'rate limited',
    last_checked: 1_234,
    failure_count: 2,
    last_failure_time: 1_100,
    last_success_time: 900,
    total_successes: 20,
    total_failures: 5,
    ...overrides,
  };
}

describe('toProviderStatsSnapshot', () => {
  it('maps persisted provider stats into a public snapshot', () => {
    const snapshot = toProviderStatsSnapshot(makeRow());

    expect(snapshot).toEqual({
      blockchain: 'ethereum',
      providerName: 'alchemy',
      avgResponseTime: 150,
      errorRate: 0.25,
      consecutiveFailures: 2,
      isHealthy: false,
      lastError: 'rate limited',
      lastChecked: 1_234,
      failureCount: 2,
      lastFailureTime: 1_100,
      lastSuccessTime: 900,
      totalSuccesses: 20,
      totalFailures: 5,
    });
  });

  it('omits lastError when the persisted row has no error message', () => {
    // eslint-disable-next-line unicorn/no-null -- we want to test the case where last_error is null in the database
    const snapshot = toProviderStatsSnapshot(makeRow({ last_error: null }));

    expect(snapshot.lastError).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { CircuitBreaker } from './circuit-breaker.ts';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions through closed → open → half-open based on failures and time', () => {
    const breaker = new CircuitBreaker('test-provider', 2, 1_000);

    expect(breaker.isClosed()).toBe(true);
    expect(breaker.getCurrentState()).toBe('closed');

    breaker.recordFailure();
    expect(breaker.isClosed()).toBe(true);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.500Z'));
    breaker.recordFailure();

    expect(breaker.isOpen()).toBe(true);
    expect(breaker.getCurrentState()).toBe('open');

    vi.setSystemTime(new Date('2024-01-01T00:00:02.000Z'));
    expect(breaker.isHalfOpen()).toBe(true);
    expect(breaker.getCurrentState()).toBe('half-open');

    const stats = breaker.getStatistics();
    expect(stats.failureCount).toBe(2);
    expect(stats.state).toBe('half-open');
    expect(stats.maxFailures).toBe(2);
    expect(stats.providerName).toBe('test-provider');
    expect(stats.timeUntilRecoveryMs).toBe(0);
  });

  it('resets failure history after success and via manual reset', () => {
    const breaker = new CircuitBreaker('test-provider', 2, 1_000);

    breaker.recordFailure();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.750Z'));
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    vi.setSystemTime(new Date('2024-01-01T00:00:02.000Z'));
    breaker.recordSuccess();

    expect(breaker.isClosed()).toBe(true);
    const statsAfterSuccess = breaker.getStatistics();
    expect(statsAfterSuccess.failureCount).toBe(0);
    expect(statsAfterSuccess.state).toBe('closed');
    expect(statsAfterSuccess.lastFailureTimestamp).toBe(0);

    breaker.recordFailure();
    expect(breaker.isClosed()).toBe(true);

    breaker.reset();
    const statsAfterReset = breaker.getStatistics();
    expect(statsAfterReset.failureCount).toBe(0);
    expect(statsAfterReset.state).toBe('closed');
    expect(statsAfterReset.lastFailureTimestamp).toBe(0);
    expect(statsAfterReset.lastSuccessTimestamp).toBe(0);
  });
});

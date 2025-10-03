import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { RateLimiter, RateLimiterFactory } from './rate-limiter.ts';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    RateLimiterFactory.reset();
  });

  it('waits for permission when rate limit is exceeded', async () => {
    const limiter = new RateLimiter('test', {
      burstLimit: 1,
      requestsPerSecond: 1,
    });

    await limiter.waitForPermission();

    let resolved = false;
    const secondRequest = limiter.waitForPermission().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await secondRequest;

    expect(resolved).toBe(true);
  });

  it('reports accurate status across windows and token bucket', async () => {
    const limiter = new RateLimiter('test', {
      burstLimit: 2,
      requestsPerHour: 4,
      requestsPerMinute: 3,
      requestsPerSecond: 2,
    });

    await limiter.waitForPermission();
    vi.setSystemTime(500);
    await limiter.waitForPermission();

    vi.setSystemTime(1_500);
    const status = limiter.getStatus();

    expect(status.tokens).toBe(2);
    expect(status.maxTokens).toBe(2);
    expect(status.requestsInLastSecond).toBe(1);
    expect(status.requestsInLastMinute).toBe(2);
    expect(status.requestsInLastHour).toBe(2);
    expect(status.requestsPerSecond).toBe(2);
  });
});

describe('RateLimiterFactory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    RateLimiterFactory.reset();
  });

  it('reuses existing limiter per provider and resets when requested', () => {
    const limiterA = RateLimiterFactory.getOrCreate('provider', { requestsPerSecond: 1 });
    const limiterB = RateLimiterFactory.getOrCreate('provider', { requestsPerSecond: 5 });

    expect(limiterB).toBe(limiterA);

    RateLimiterFactory.reset('provider');
    const limiterC = RateLimiterFactory.getOrCreate('provider', { requestsPerSecond: 2 });

    expect(limiterC).not.toBe(limiterA);
  });
});

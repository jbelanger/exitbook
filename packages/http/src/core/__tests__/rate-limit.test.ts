import { describe, expect, it } from 'vitest';

import {
  calculateWaitTime,
  canMakeRequestInAllWindows,
  cleanOldTimestamps,
  consumeToken,
  getRequestCountInWindow,
  getRateLimitStatus,
  refillTokens,
  shouldAllowRequest,
} from '../rate-limit.js';
import { createInitialRateLimitState } from '../types.js';

describe('rate-limit (pure functions)', () => {
  describe('refillTokens', () => {
    it('initializes lastRefill on first call', () => {
      const state = createInitialRateLimitState({ requestsPerSecond: 1 });
      const result = refillTokens(state, 1000);

      expect(result.lastRefill).toBe(1000);
      expect(result.tokens).toBe(1); // Unchanged
    });

    it('refills tokens based on time passed', () => {
      const state = {
        ...createInitialRateLimitState({ burstLimit: 5, requestsPerSecond: 2 }),
        lastRefill: 1000,
        tokens: 1,
      };

      // 2 seconds passed = 4 tokens (2 per second)
      const result = refillTokens(state, 3000);

      expect(result.tokens).toBe(5); // Capped at burstLimit
      expect(result.lastRefill).toBe(3000);
    });

    it('does not refill when no time has passed', () => {
      const state = {
        ...createInitialRateLimitState({ requestsPerSecond: 1 }),
        lastRefill: 1000,
        tokens: 0.5,
      };

      const result = refillTokens(state, 1000);

      expect(result.tokens).toBe(0.5);
      expect(result.lastRefill).toBe(1000);
    });
  });

  describe('getRequestCountInWindow', () => {
    it('counts requests within time window', () => {
      const timestamps = [1000, 2000, 3000, 4000, 5000];
      const currentTime = 5000;

      expect(getRequestCountInWindow(timestamps, currentTime, 1000)).toBe(2); // Last second: 4000, 5000
      expect(getRequestCountInWindow(timestamps, currentTime, 3000)).toBe(4); // Last 3 seconds: 2000, 3000, 4000, 5000
      expect(getRequestCountInWindow(timestamps, currentTime, 10_000)).toBe(5); // All requests
    });

    it('returns 0 when no requests in window', () => {
      const timestamps = [1000, 2000];
      const currentTime = 10_000;

      expect(getRequestCountInWindow(timestamps, currentTime, 1000)).toBe(0);
    });
  });

  describe('canMakeRequestInAllWindows', () => {
    it('allows request when all limits are respected', () => {
      const state = {
        ...createInitialRateLimitState({
          requestsPerHour: 100,
          requestsPerMinute: 10,
          requestsPerSecond: 2,
        }),
        requestTimestamps: [1000, 2500],
      };

      expect(canMakeRequestInAllWindows(state, 5000)).toBe(true);
    });

    it('blocks request when per-second limit exceeded', () => {
      const state = {
        ...createInitialRateLimitState({
          requestsPerSecond: 2,
        }),
        requestTimestamps: [4000, 4500], // 2 requests in last second
      };

      expect(canMakeRequestInAllWindows(state, 5000)).toBe(false);
    });

    it('blocks request when per-minute limit exceeded', () => {
      const state = {
        ...createInitialRateLimitState({
          requestsPerMinute: 3,
          requestsPerSecond: 10,
        }),
        requestTimestamps: [50_000, 55_000, 58_000], // 3 requests in last minute
      };

      expect(canMakeRequestInAllWindows(state, 60_000)).toBe(false);
    });

    it('blocks request when per-hour limit exceeded', () => {
      const state = {
        ...createInitialRateLimitState({
          requestsPerHour: 2,
          requestsPerSecond: 10,
        }),
        requestTimestamps: [1_000_000, 2_000_000], // 2 requests in last hour
      };

      expect(canMakeRequestInAllWindows(state, 3_000_000)).toBe(false);
    });
  });

  describe('cleanOldTimestamps', () => {
    it('removes timestamps older than 1 hour', () => {
      const timestamps = [
        1000, // > 1 hour old
        2_000_000, // > 1 hour old
        3_600_001, // Within 1 hour (current - 3_600_000)
        7_000_000, // Within 1 hour
      ];
      const currentTime = 7_200_001; // 2 hours + 1ms

      const result = cleanOldTimestamps(timestamps, currentTime);

      expect(result).toEqual([3_600_001, 7_000_000]);
    });

    it('keeps all timestamps when all are recent', () => {
      const timestamps = [5000, 10_000, 15_000];
      const currentTime = 20_000;

      const result = cleanOldTimestamps(timestamps, currentTime);

      expect(result).toEqual(timestamps);
    });
  });

  describe('shouldAllowRequest', () => {
    it('allows request when tokens available and windows clear', () => {
      const state = {
        ...createInitialRateLimitState({ burstLimit: 5, requestsPerSecond: 2 }),
        lastRefill: 1000,
        tokens: 3,
      };

      expect(shouldAllowRequest(state, 2000)).toBe(true);
    });

    it('blocks request when no tokens available', () => {
      const state = {
        ...createInitialRateLimitState({ burstLimit: 1, requestsPerSecond: 1 }),
        lastRefill: 1000,
        tokens: 0,
      };

      expect(shouldAllowRequest(state, 1500)).toBe(false);
    });

    it('blocks request when window limit exceeded', () => {
      const state = {
        ...createInitialRateLimitState({
          burstLimit: 10,
          requestsPerSecond: 2,
        }),
        lastRefill: 1000,
        requestTimestamps: [4000, 4500], // 2 requests in last second
        tokens: 5, // Tokens available but window limit hit
      };

      expect(shouldAllowRequest(state, 5000)).toBe(false);
    });
  });

  describe('calculateWaitTime', () => {
    it('returns 0 when request can be made immediately', () => {
      const state = {
        ...createInitialRateLimitState({ burstLimit: 5, requestsPerSecond: 2 }),
        lastRefill: 1000,
        tokens: 3,
      };

      expect(calculateWaitTime(state, 2000)).toBe(0);
    });

    it('calculates wait time based on token bucket', () => {
      const state = {
        ...createInitialRateLimitState({ burstLimit: 1, requestsPerSecond: 1 }),
        lastRefill: 1000,
        tokens: 0,
      };

      const waitTime = calculateWaitTime(state, 1000);

      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(1000);
    });

    it('calculates wait time based on per-second window', () => {
      const state = {
        ...createInitialRateLimitState({
          burstLimit: 10,
          requestsPerSecond: 2,
        }),
        lastRefill: 1000,
        requestTimestamps: [4000, 4500],
        tokens: 5,
      };

      const waitTime = calculateWaitTime(state, 5000);

      // Should wait until oldest request (4000) falls outside 1s window
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(1010); // 1000ms + 10ms buffer
    });

    it('returns maximum wait time across all windows', () => {
      const state = {
        ...createInitialRateLimitState({
          burstLimit: 10,
          requestsPerMinute: 2,
          requestsPerSecond: 10,
        }),
        lastRefill: 50_000,
        requestTimestamps: [50_000, 55_000],
        tokens: 5,
      };

      const waitTime = calculateWaitTime(state, 60_000);

      // Should wait for per-minute window (oldest at 50,000)
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(60_010); // 60s + 10ms buffer
    });
  });

  describe('consumeToken', () => {
    it('consumes token and adds timestamp', () => {
      const state = {
        ...createInitialRateLimitState({ burstLimit: 5, requestsPerSecond: 2 }),
        lastRefill: 1000,
        requestTimestamps: [],
        tokens: 3,
      };

      const result = consumeToken(state, 2000);

      // Tokens refilled first (1s * 2/s = 2 tokens), so 3 + 2 = 5, then consume 1 = 4
      expect(result.tokens).toBeGreaterThanOrEqual(3); // Refilled before consuming
      expect(result.requestTimestamps).toContain(2000);
    });

    it('refills tokens before consuming', () => {
      const state = {
        ...createInitialRateLimitState({ burstLimit: 5, requestsPerSecond: 2 }),
        lastRefill: 1000,
        tokens: 1,
      };

      // 1 second passed = 2 tokens refilled
      const result = consumeToken(state, 2000);

      // Had 1, gained 2, lost 1 = 2
      expect(result.tokens).toBeCloseTo(2, 1);
    });

    it('cleans old timestamps', () => {
      const state = {
        ...createInitialRateLimitState({ requestsPerSecond: 1 }),
        lastRefill: 1000,
        requestTimestamps: [1000, 2000], // Old timestamps
        tokens: 1,
      };

      const result = consumeToken(state, 4_000_000);

      // Old timestamps should be removed
      expect(result.requestTimestamps.length).toBe(1);
      expect(result.requestTimestamps).toContain(4_000_000);
    });
  });

  describe('getRateLimitStatus', () => {
    it('returns current status with refilled tokens', () => {
      const state = {
        ...createInitialRateLimitState({
          burstLimit: 5,
          requestsPerHour: 100,
          requestsPerMinute: 10,
          requestsPerSecond: 2,
        }),
        lastRefill: 1000,
        requestTimestamps: [1500, 2000, 2500],
        tokens: 1,
      };

      const status = getRateLimitStatus(state, 3000);

      expect(status.tokens).toBeGreaterThan(1); // Refilled
      expect(status.maxTokens).toBe(5);
      expect(status.requestsPerSecond).toBe(2);
      expect(status.requestsInLastSecond).toBe(2); // 2000 and 2500 are within last second from 3000
      expect(status.requestsInLastMinute).toBe(3);
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  getCircuitStatistics,
  getCircuitStatus,
  isCircuitClosed,
  isCircuitHalfOpen,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  resetCircuit,
  shouldCircuitBlock,
} from '../circuit-breaker.ts';
import { createInitialCircuitState } from '../types.ts';

describe('circuit-breaker (pure functions)', () => {
  describe('getCircuitStatus', () => {
    it('returns closed when failures below threshold', () => {
      const state = createInitialCircuitState(3, 5000);

      expect(getCircuitStatus(state, 1000)).toBe('closed');
    });

    it('returns open when failures exceed threshold and within timeout', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      expect(getCircuitStatus(state, 3000)).toBe('open'); // 2s since failure, timeout is 5s
    });

    it('returns half-open when failures exceed threshold but timeout passed', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      expect(getCircuitStatus(state, 6500)).toBe('half-open'); // 5.5s since failure, timeout is 5s
    });
  });

  describe('shouldCircuitBlock', () => {
    it('does not block when circuit is closed', () => {
      const state = createInitialCircuitState(3, 5000);

      expect(shouldCircuitBlock(state, 1000)).toBe(false);
    });

    it('blocks when circuit is open', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      expect(shouldCircuitBlock(state, 3000)).toBe(true);
    });

    it('does not block when circuit is half-open', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      expect(shouldCircuitBlock(state, 6500)).toBe(false);
    });
  });

  describe('isCircuitClosed', () => {
    it('returns true when failure count below threshold', () => {
      const state = {
        ...createInitialCircuitState(3, 5000),
        failureCount: 2,
      };

      expect(isCircuitClosed(state)).toBe(true);
    });

    it('returns false when failure count at threshold', () => {
      const state = {
        ...createInitialCircuitState(3, 5000),
        failureCount: 3,
      };

      expect(isCircuitClosed(state)).toBe(false);
    });
  });

  describe('isCircuitHalfOpen', () => {
    it('returns true when failures at threshold and timeout passed', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      expect(isCircuitHalfOpen(state, 6000)).toBe(true);
    });

    it('returns false when failures below threshold', () => {
      const state = {
        ...createInitialCircuitState(3, 5000),
        failureCount: 1,
      };

      expect(isCircuitHalfOpen(state, 10_000)).toBe(false);
    });

    it('returns false when timeout not yet passed', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      expect(isCircuitHalfOpen(state, 3000)).toBe(false);
    });
  });

  describe('isCircuitOpen', () => {
    it('returns true when failures at threshold and within timeout', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      expect(isCircuitOpen(state, 3000)).toBe(true);
    });

    it('returns false when timeout has passed', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      expect(isCircuitOpen(state, 7000)).toBe(false);
    });

    it('returns false when failures below threshold', () => {
      const state = {
        ...createInitialCircuitState(3, 5000),
        failureCount: 1,
      };

      expect(isCircuitOpen(state, 10_000)).toBe(false);
    });
  });

  describe('recordFailure', () => {
    it('increments failure count and records timestamp', () => {
      const state = createInitialCircuitState(3, 5000);

      const result = recordFailure(state, 1000);

      expect(result.failureCount).toBe(1);
      expect(result.lastFailureTime).toBe(1000);
    });

    it('preserves other state properties', () => {
      const state = createInitialCircuitState(3, 5000);

      const result = recordFailure(state, 1000);

      expect(result.maxFailures).toBe(3);
      expect(result.recoveryTimeoutMs).toBe(5000);
    });
  });

  describe('recordSuccess', () => {
    it('resets failure count and records success timestamp', () => {
      const state = {
        ...createInitialCircuitState(3, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      const result = recordSuccess(state, 5000);

      expect(result.failureCount).toBe(0);
      expect(result.lastFailureTime).toBe(0);
      expect(result.lastSuccessTime).toBe(5000);
    });

    it('preserves configuration properties', () => {
      const state = createInitialCircuitState(3, 5000);

      const result = recordSuccess(state, 1000);

      expect(result.maxFailures).toBe(3);
      expect(result.recoveryTimeoutMs).toBe(5000);
    });
  });

  describe('resetCircuit', () => {
    it('resets all counters and timestamps', () => {
      const state = {
        ...createInitialCircuitState(3, 5000),
        failureCount: 5,
        lastFailureTime: 1000,
        lastSuccessTime: 500,
      };

      const result = resetCircuit(state);

      expect(result.failureCount).toBe(0);
      expect(result.lastFailureTime).toBe(0);
      expect(result.lastSuccessTime).toBe(0);
    });

    it('preserves configuration', () => {
      const state = createInitialCircuitState(7, 10_000);

      const result = resetCircuit(state);

      expect(result.maxFailures).toBe(7);
      expect(result.recoveryTimeoutMs).toBe(10_000);
    });
  });

  describe('getCircuitStatistics', () => {
    it('returns comprehensive statistics for closed circuit', () => {
      const state = createInitialCircuitState(3, 5000);

      const stats = getCircuitStatistics(state, 1000);

      expect(stats).toEqual({
        failureCount: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0,
        maxFailures: 3,
        recoveryTimeoutMs: 5000,
        state: 'closed',
        timeSinceLastFailureMs: 0,
        timeUntilRecoveryMs: 0,
      });
    });

    it('returns statistics for open circuit with time calculations', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
      };

      const stats = getCircuitStatistics(state, 3000);

      expect(stats.state).toBe('open');
      expect(stats.timeSinceLastFailureMs).toBe(2000);
      expect(stats.timeUntilRecoveryMs).toBe(3000); // 5000 - 2000
    });

    it('returns statistics for half-open circuit', () => {
      const state = {
        ...createInitialCircuitState(2, 5000),
        failureCount: 2,
        lastFailureTime: 1000,
        lastSuccessTime: 500,
      };

      const stats = getCircuitStatistics(state, 6500);

      expect(stats.state).toBe('half-open');
      expect(stats.timeSinceLastFailureMs).toBe(5500);
      expect(stats.timeUntilRecoveryMs).toBe(0);
    });
  });

  describe('state transitions', () => {
    it('transitions from closed -> open -> half-open -> closed', () => {
      let state = createInitialCircuitState(2, 1000);
      let currentTime = 0;

      // Closed initially
      expect(getCircuitStatus(state, currentTime)).toBe('closed');

      // Record first failure - still closed
      state = recordFailure(state, currentTime);
      currentTime += 100;
      expect(getCircuitStatus(state, currentTime)).toBe('closed');

      // Record second failure - now open
      state = recordFailure(state, currentTime);
      currentTime += 100;
      expect(getCircuitStatus(state, currentTime)).toBe('open');

      // Still open within timeout
      currentTime += 500;
      expect(getCircuitStatus(state, currentTime)).toBe('open');

      // Half-open after timeout
      currentTime += 500; // Total 1100ms
      expect(getCircuitStatus(state, currentTime)).toBe('half-open');

      // Success closes circuit
      state = recordSuccess(state, currentTime);
      expect(getCircuitStatus(state, currentTime)).toBe('closed');
    });
  });
});

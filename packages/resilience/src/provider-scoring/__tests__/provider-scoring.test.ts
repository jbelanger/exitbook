import { describe, expect, it } from 'vitest';

import { recordFailure } from '../../circuit-breaker/circuit-breaker.js';
import { createInitialCircuitState } from '../../circuit-breaker/types.js';
import { createInitialHealth } from '../../provider-health/provider-health.js';
import { scoreProviderHealth } from '../provider-scoring.js';

describe('scoreProviderHealth', () => {
  const now = Date.now();

  it('returns base score + fast response bonus for healthy provider', () => {
    const health = createInitialHealth();
    const circuit = createInitialCircuitState();

    // Base 100 + fast response 20 (0ms < 1000ms)
    expect(scoreProviderHealth(health, circuit, now)).toBe(120);
  });

  it('penalizes unhealthy provider', () => {
    const health = { ...createInitialHealth(), isHealthy: false };
    const circuit = createInitialCircuitState();

    // 100 - 50 (unhealthy) + 20 (fast)
    expect(scoreProviderHealth(health, circuit, now)).toBe(70);
  });

  it('heavily penalizes open circuit', () => {
    const health = createInitialHealth();
    let circuit = createInitialCircuitState();
    for (let i = 0; i < 10; i++) {
      circuit = recordFailure(circuit, now);
    }

    // 100 - 100 (open) + 20 (fast)
    expect(scoreProviderHealth(health, circuit, now)).toBe(20);
  });

  it('moderately penalizes half-open circuit', () => {
    const health = createInitialHealth();
    let circuit = createInitialCircuitState(3, 60_000);
    for (let i = 0; i < 5; i++) {
      circuit = recordFailure(circuit, now);
    }
    const laterTime = now + 70_000; // past recovery timeout

    // 100 - 25 (half-open) + 20 (fast)
    expect(scoreProviderHealth(health, circuit, laterTime)).toBe(95);
  });

  it('adds fast response bonus for < 1000ms', () => {
    const health = { ...createInitialHealth(), averageResponseTime: 500 };
    const circuit = createInitialCircuitState();

    // 100 + 20 (fast)
    expect(scoreProviderHealth(health, circuit, now)).toBe(120);
  });

  it('penalizes slow response for > 5000ms', () => {
    const health = { ...createInitialHealth(), averageResponseTime: 6000 };
    const circuit = createInitialCircuitState();

    // 100 - 30 (slow)
    expect(scoreProviderHealth(health, circuit, now)).toBe(70);
  });

  it('penalizes based on error rate', () => {
    const health = { ...createInitialHealth(), errorRate: 0.5, averageResponseTime: 1500 };
    const circuit = createInitialCircuitState();

    // 100 - 25 (50% * 50)
    expect(scoreProviderHealth(health, circuit, now)).toBe(75);
  });

  it('penalizes consecutive failures', () => {
    const health = { ...createInitialHealth(), consecutiveFailures: 3 };
    const circuit = createInitialCircuitState();

    // 100 - 30 (3 × 10) + 20 (fast)
    expect(scoreProviderHealth(health, circuit, now)).toBe(90);
  });

  it('returns raw negative score for callers to clamp', () => {
    const health = {
      ...createInitialHealth(),
      isHealthy: false,
      errorRate: 1.0,
      consecutiveFailures: 10,
      averageResponseTime: 10000,
    };
    let circuit = createInitialCircuitState();
    for (let i = 0; i < 10; i++) {
      circuit = recordFailure(circuit, now);
    }

    // Raw score is negative; callers apply Math.max(0, score + domainBonus)
    expect(scoreProviderHealth(health, circuit, now)).toBeLessThan(0);
  });
});

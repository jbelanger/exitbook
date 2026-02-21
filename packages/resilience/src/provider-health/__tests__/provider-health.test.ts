/**
 * Tests for shared provider health utilities
 * Pure function tests — no mocks needed
 */

import { describe, expect, it } from 'vitest';

import { createInitialCircuitState, recordFailure, type CircuitState } from '../../circuit-breaker/index.js';
import {
  createInitialHealth,
  getProviderHealthWithCircuit,
  hasAvailableProviders,
  shouldBlockDueToCircuit,
  updateHealthMetrics,
} from '../provider-health.js';

describe('createInitialHealth', () => {
  it('should create health with defaults', () => {
    const health = createInitialHealth();
    expect(health).toEqual({
      averageResponseTime: 0,
      consecutiveFailures: 0,
      errorRate: 0,
      isHealthy: true,
      lastChecked: 0,
    });
    expect(health.lastError).toBeUndefined();
  });
});

describe('updateHealthMetrics', () => {
  const now = 1000;

  it('should update health on success', () => {
    const health = createInitialHealth();
    const updated = updateHealthMetrics(health, true, 500, now);

    expect(updated.isHealthy).toBe(true);
    expect(updated.lastChecked).toBe(now);
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.averageResponseTime).toBe(500);
  });

  it('should initialize response time on first success', () => {
    const health = createInitialHealth();
    const updated = updateHealthMetrics(health, true, 1000, now);
    expect(updated.averageResponseTime).toBe(1000);
  });

  it('should calculate EMA for response time on subsequent success', () => {
    const health = { ...createInitialHealth(), averageResponseTime: 1000 };
    const updated = updateHealthMetrics(health, true, 500, now);
    expect(updated.averageResponseTime).toBe(900); // 1000 * 0.8 + 500 * 0.2
  });

  it('should not update response time on failure', () => {
    const health = { ...createInitialHealth(), averageResponseTime: 1000 };
    const updated = updateHealthMetrics(health, false, 500, now);
    expect(updated.averageResponseTime).toBe(1000);
  });

  it('should mark unhealthy on failure with error message', () => {
    const health = createInitialHealth();
    const updated = updateHealthMetrics(health, false, 0, now, 'Test error');
    expect(updated.isHealthy).toBe(false);
    expect(updated.lastError).toBe('Test error');
  });

  it('should increment consecutive failures on failure', () => {
    let updated = updateHealthMetrics(createInitialHealth(), false, 0, now);
    expect(updated.consecutiveFailures).toBe(1);
    updated = updateHealthMetrics(updated, false, 0, now);
    expect(updated.consecutiveFailures).toBe(2);
  });

  it('should reset consecutive failures on success', () => {
    const health = { ...createInitialHealth(), consecutiveFailures: 5 };
    const updated = updateHealthMetrics(health, true, 1000, now);
    expect(updated.consecutiveFailures).toBe(0);
  });

  it('should preserve lastError on success (for debugging)', () => {
    const health = { ...createInitialHealth(), lastError: 'previous error' };
    const updated = updateHealthMetrics(health, true, 500, now);
    expect(updated.lastError).toBe('previous error');
  });

  it('should update error rate with EMA', () => {
    const health = createInitialHealth();
    let updated = updateHealthMetrics(health, false, 0, now);
    expect(updated.errorRate).toBe(0.1); // 0 * 0.9 + 1 * 0.1

    updated = updateHealthMetrics(updated, false, 0, now);
    expect(updated.errorRate).toBeCloseTo(0.19); // 0.1 * 0.9 + 1 * 0.1

    updated = updateHealthMetrics(updated, true, 1000, now);
    expect(updated.errorRate).toBeCloseTo(0.171); // 0.19 * 0.9 + 0 * 0.1
  });

  it('should not mutate original health object', () => {
    const health = createInitialHealth();
    const original = { ...health };
    updateHealthMetrics(health, false, 0, now, 'Error');
    expect(health).toEqual(original);
  });
});

describe('getProviderHealthWithCircuit', () => {
  it('should combine health with closed circuit status', () => {
    const health = createInitialHealth();
    const circuit = createInitialCircuitState();
    const result = getProviderHealthWithCircuit(health, circuit, Date.now());
    expect(result.circuitState).toBe('closed');
    expect(result.isHealthy).toBe(true);
  });

  it('should show open circuit state', () => {
    const health = createInitialHealth();
    const now = Date.now();
    let circuit = createInitialCircuitState();
    for (let i = 0; i < 10; i++) {
      circuit = recordFailure(circuit, now);
    }
    const result = getProviderHealthWithCircuit(health, circuit, now);
    expect(result.circuitState).toBe('open');
  });
});

describe('shouldBlockDueToCircuit', () => {
  it('should not block when circuit is closed', () => {
    const circuit = createInitialCircuitState();
    expect(shouldBlockDueToCircuit(circuit, true, Date.now())).toBeUndefined();
  });

  it('should block when circuit is open and alternatives exist', () => {
    const now = Date.now();
    const circuit: CircuitState = {
      ...createInitialCircuitState(),
      failureCount: 5,
      lastFailureTime: now - 1000,
    };
    expect(shouldBlockDueToCircuit(circuit, true, now)).toBe('circuit_open');
  });

  it('should return circuit_open_no_alternatives when open and no alternatives', () => {
    const now = Date.now();
    const circuit: CircuitState = {
      ...createInitialCircuitState(),
      failureCount: 5,
      lastFailureTime: now - 1000,
    };
    expect(shouldBlockDueToCircuit(circuit, false, now)).toBe('circuit_open_no_alternatives');
  });

  it('should return circuit_half_open when in half-open state', () => {
    const now = Date.now();
    const circuit: CircuitState = {
      ...createInitialCircuitState(),
      failureCount: 5,
      lastFailureTime: now - 70000,
      recoveryTimeoutMs: 60000,
    };
    expect(shouldBlockDueToCircuit(circuit, true, now)).toBe('circuit_half_open');
  });
});

describe('hasAvailableProviders', () => {
  const stubProvider = (name: string) => ({ name });

  it('should return true when at least one provider has closed circuit', () => {
    const circuitMap = new Map<string, CircuitState>([
      ['provider-1', createInitialCircuitState()],
      ['provider-2', createInitialCircuitState()],
    ]);
    expect(
      hasAvailableProviders([stubProvider('provider-1'), stubProvider('provider-2')], circuitMap, Date.now())
    ).toBe(true);
  });

  it('should return false when all providers have open circuits', () => {
    const now = Date.now();
    let state1 = createInitialCircuitState();
    let state2 = createInitialCircuitState();
    for (let i = 0; i < 10; i++) {
      state1 = recordFailure(state1, now);
      state2 = recordFailure(state2, now);
    }
    const circuitMap = new Map<string, CircuitState>([
      ['provider-1', state1],
      ['provider-2', state2],
    ]);
    expect(hasAvailableProviders([stubProvider('provider-1'), stubProvider('provider-2')], circuitMap, now)).toBe(
      false
    );
  });

  it('should return true when provider has no circuit state (not yet registered)', () => {
    const circuitMap = new Map<string, CircuitState>();
    expect(hasAvailableProviders([stubProvider('provider-1')], circuitMap, Date.now())).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { CircuitBreakerRegistry } from '../registry.js';
import { createInitialCircuitState } from '../types.js';

describe('CircuitBreakerRegistry', () => {
  it('creates and reuses state for the same provider key', () => {
    const registry = new CircuitBreakerRegistry();

    const first = registry.getOrCreate('provider-a');
    const second = registry.getOrCreate('provider-a');

    expect(first).toBe(second);
    expect(first).toEqual(createInitialCircuitState());
  });

  it('records failure and success transitions', () => {
    const registry = new CircuitBreakerRegistry();

    const failed = registry.recordFailure('provider-a', 1000);
    expect(failed.failureCount).toBe(1);
    expect(failed.lastFailureTime).toBe(1000);

    const recovered = registry.recordSuccess('provider-a', 2000);
    expect(recovered.failureCount).toBe(0);
    expect(recovered.lastFailureTime).toBe(0);
    expect(recovered.lastSuccessTime).toBe(2000);
  });

  it('resets state and supports lifecycle helpers', () => {
    const registry = new CircuitBreakerRegistry();
    registry.set('provider-a', {
      ...createInitialCircuitState(),
      failureCount: 3,
      lastFailureTime: 500,
      lastSuccessTime: 250,
    });

    registry.reset('provider-a');
    const reset = registry.get('provider-a');
    expect(reset?.failureCount).toBe(0);
    expect(reset?.lastFailureTime).toBe(0);
    expect(reset?.lastSuccessTime).toBe(0);

    expect(Array.from(registry.entries())).toHaveLength(1);
    expect(registry.has('provider-a')).toBe(true);
    expect(registry.asReadonlyMap().get('provider-a')).toBeDefined();

    registry.clear();
    expect(registry.has('provider-a')).toBe(false);
  });
});

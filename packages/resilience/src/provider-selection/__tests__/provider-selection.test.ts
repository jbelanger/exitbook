import { describe, expect, it } from 'vitest';

import { createInitialCircuitState } from '../../circuit-breaker/types.js';
import type { CircuitState } from '../../circuit-breaker/types.js';
import { createInitialHealth } from '../../provider-health/provider-health.js';
import type { IProvider, ProviderHealth } from '../../provider-health/types.js';
import { buildProviderSelectionDebugInfo, selectProviders } from '../provider-selection.js';

function createProvider(name: string): IProvider {
  return { name };
}

function setupMaps(
  providers: IProvider[],
  healthOverrides?: Record<string, Partial<ProviderHealth>>
): { circuitMap: Map<string, CircuitState>; healthMap: Map<string, ProviderHealth> } {
  const healthMap = new Map<string, ProviderHealth>();
  const circuitMap = new Map<string, CircuitState>();
  for (const p of providers) {
    healthMap.set(p.name, { ...createInitialHealth(), ...healthOverrides?.[p.name] });
    circuitMap.set(p.name, createInitialCircuitState());
  }
  return { healthMap, circuitMap };
}

describe('selectProviders', () => {
  it('returns all providers sorted by score descending', () => {
    const fast = createProvider('fast');
    const slow = createProvider('slow');
    const { healthMap, circuitMap } = setupMaps([fast, slow], {
      fast: { averageResponseTime: 200 },
      slow: { averageResponseTime: 6000 },
    });

    const result = selectProviders([slow, fast], healthMap, circuitMap, Date.now());

    expect(result).toHaveLength(2);
    expect(result[0]!.provider.name).toBe('fast');
    expect(result[1]!.provider.name).toBe('slow');
  });

  it('applies domain filter', () => {
    const a = createProvider('a');
    const b = createProvider('b');
    const { healthMap, circuitMap } = setupMaps([a, b]);

    const result = selectProviders([a, b], healthMap, circuitMap, Date.now(), {
      filter: (p) => p.name === 'b',
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.provider.name).toBe('b');
  });

  it('adds bonus score from options', () => {
    const a = createProvider('a');
    const b = createProvider('b');
    const { healthMap, circuitMap } = setupMaps([a, b]);

    const result = selectProviders([a, b], healthMap, circuitMap, Date.now(), {
      bonusScore: (p) => (p.name === 'b' ? 50 : 0),
    });

    expect(result[0]!.provider.name).toBe('b');
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });

  it('skips providers with missing health or circuit state', () => {
    const a = createProvider('a');
    const b = createProvider('b');
    const healthMap = new Map<string, ProviderHealth>([['a', createInitialHealth()]]);
    const circuitMap = new Map([
      ['a', createInitialCircuitState()],
      ['b', createInitialCircuitState()],
    ]);

    const result = selectProviders([a, b], healthMap, circuitMap, Date.now());

    expect(result).toHaveLength(1);
    expect(result[0]!.provider.name).toBe('a');
  });

  it('clamps score to 0 minimum', () => {
    const p = createProvider('bad');
    const { healthMap, circuitMap } = setupMaps([p], {
      bad: { isHealthy: false, errorRate: 1.0, consecutiveFailures: 10, averageResponseTime: 10000 },
    });

    const result = selectProviders([p], healthMap, circuitMap, Date.now());

    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(0);
  });
});

describe('buildProviderSelectionDebugInfo', () => {
  it('builds JSON with provider info', () => {
    const scored = [
      {
        provider: createProvider('test'),
        health: { ...createInitialHealth(), averageResponseTime: 1234.56, errorRate: 0.123, consecutiveFailures: 2 },
        score: 85.5,
      },
    ];

    const parsed = JSON.parse(buildProviderSelectionDebugInfo(scored)) as unknown[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      name: 'test',
      score: 85.5,
      avgResponseTime: 1235,
      errorRate: 12,
      consecutiveFailures: 2,
      isHealthy: true,
    });
  });
});

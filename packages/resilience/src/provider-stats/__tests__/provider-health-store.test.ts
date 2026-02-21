import { describe, expect, it } from 'vitest';

import { createInitialCircuitState } from '../../circuit-breaker/types.js';
import { ProviderHealthStore } from '../provider-health-store.js';

describe('ProviderHealthStore', () => {
  it('initializeProvider creates default healthy state', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('test');

    const health = store.getHealth('test');
    expect(health).toBeDefined();
    expect(health?.isHealthy).toBe(true);
    expect(health?.consecutiveFailures).toBe(0);
    expect(health?.errorRate).toBe(0);
  });

  it('initializeProvider is idempotent', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('test');
    const health1 = store.getHealth('test');

    store.initializeProvider('test');
    const health2 = store.getHealth('test');

    expect(health1).toBe(health2);
  });

  it('hasHealth returns false for unknown key', () => {
    const store = new ProviderHealthStore();
    expect(store.hasHealth('unknown')).toBe(false);
  });

  it('updateHealth tracks consecutive failures and error message', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('test');
    store.updateHealth('test', true, 120);
    store.updateHealth('test', false, 0, 'timeout');

    const health = store.getHealth('test');
    expect(health?.consecutiveFailures).toBe(1);
    expect(health?.lastError).toBe('timeout');
    expect(health?.isHealthy).toBe(false);
  });

  it('updateHealth resets consecutive failures on success', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('test');
    store.updateHealth('test', false, 0, 'error');
    store.updateHealth('test', false, 0, 'error');
    store.updateHealth('test', true, 100);

    expect(store.getHealth('test')?.consecutiveFailures).toBe(0);
    expect(store.getHealth('test')?.isHealthy).toBe(true);
  });

  it('updateHealth increments success/failure counters', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('test');
    store.updateHealth('test', true, 100);
    store.updateHealth('test', true, 100);
    store.updateHealth('test', false, 0, 'err');

    expect(store.getTotalSuccesses('test')).toBe(2);
    expect(store.getTotalFailures('test')).toBe(1);
  });

  it('getProviderHealthWithCircuit combines health with circuit state', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('test');

    const result = store.getProviderHealthWithCircuit('test', createInitialCircuitState(), Date.now());
    expect(result).toBeDefined();
    expect(result?.circuitState).toBe('closed');
    expect(result?.isHealthy).toBe(true);
  });

  it('getProviderHealthWithCircuit returns undefined for unknown key', () => {
    const store = new ProviderHealthStore();
    expect(store.getProviderHealthWithCircuit('unknown', createInitialCircuitState(), Date.now())).toBeUndefined();
  });

  it('getHealthMapForKeys remaps keys', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('ethereum/moralis');
    store.initializeProvider('bitcoin/blockstream');

    const map = store.getHealthMapForKeys([{ key: 'ethereum/moralis', mapAs: 'moralis' }]);

    expect(map.size).toBe(1);
    expect(map.has('moralis')).toBe(true);
    expect(map.has('blockstream')).toBe(false);
  });

  it('getHealthMapForKeys returns empty map for missing keys', () => {
    const store = new ProviderHealthStore();
    const map = store.getHealthMapForKeys([{ key: 'unknown', mapAs: 'test' }]);
    expect(map.size).toBe(0);
  });

  it('load bulk-loads pre-hydrated state', () => {
    const store = new ProviderHealthStore();
    store.load(
      'test',
      {
        averageResponseTime: 200,
        consecutiveFailures: 1,
        errorRate: 0.1,
        isHealthy: false,
        lastChecked: 1000,
        lastError: 'some error',
      },
      50,
      5
    );

    expect(store.getHealth('test')?.averageResponseTime).toBe(200);
    expect(store.getTotalSuccesses('test')).toBe(50);
    expect(store.getTotalFailures('test')).toBe(5);
  });

  it('export returns all snapshots', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('a');
    store.initializeProvider('b');
    store.updateHealth('a', true, 100);

    const snapshots = store.getSnapshots();
    expect(snapshots).toHaveLength(2);

    const snapshotA = snapshots.find((s) => s.key === 'a');
    expect(snapshotA?.totalSuccesses).toBe(1);
    expect(snapshotA?.totalFailures).toBe(0);
  });

  it('clear resets all state', () => {
    const store = new ProviderHealthStore();
    store.initializeProvider('test');
    store.clear();

    expect(store.hasHealth('test')).toBe(false);
    expect(store.getTotalSuccesses('test')).toBe(0);
    expect(store.getTotalFailures('test')).toBe(0);
  });
});

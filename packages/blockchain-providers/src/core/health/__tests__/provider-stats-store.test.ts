/**
 * Tests for ProviderStatsStore and composite key helpers.
 */

import { createInitialCircuitState } from '@exitbook/resilience/circuit-breaker';
import { describe, expect, test } from 'vitest';

import { getProviderKey, parseProviderKey, ProviderStatsStore, type ProviderKey } from '../provider-stats-store.js';

describe('getProviderKey / parseProviderKey', () => {
  test('encodes blockchain and provider name into a composite key', () => {
    expect(getProviderKey('ethereum', 'moralis')).toBe('ethereum/moralis');
  });

  test('round-trips through parseProviderKey', () => {
    const key = getProviderKey('bitcoin', 'blockstream');
    expect(parseProviderKey(key)).toEqual({ blockchain: 'bitcoin', providerName: 'blockstream' });
  });

  test('parseProviderKey throws on keys without a slash', () => {
    expect(() => parseProviderKey('no-slash' as ProviderKey)).toThrow('Invalid provider key format');
  });
});

describe('ProviderStatsStore', () => {
  test('initializeProvider creates default healthy state', () => {
    const store = new ProviderStatsStore();
    const key = getProviderKey('ethereum', 'moralis');

    store.initializeProvider(key);

    const health = store.getHealth(key);
    expect(health).toBeDefined();
    expect(health?.isHealthy).toBe(true);
    expect(health?.consecutiveFailures).toBe(0);
    expect(health?.errorRate).toBe(0);
  });

  test('initializeProvider is idempotent — does not overwrite existing state', () => {
    const store = new ProviderStatsStore();
    const key = getProviderKey('ethereum', 'moralis');

    store.initializeProvider(key);
    const health1 = store.getHealth(key);

    store.initializeProvider(key);
    const health2 = store.getHealth(key);

    expect(health1).toBe(health2); // same object reference
  });

  test('hasHealth returns false for unknown key', () => {
    const store = new ProviderStatsStore();
    expect(store.hasHealth('ethereum/unknown' as ProviderKey)).toBe(false);
  });

  test('updateHealth tracks consecutive failures and error message', () => {
    const store = new ProviderStatsStore();
    const key = getProviderKey('ethereum', 'moralis');

    store.initializeProvider(key);
    store.updateHealth(key, true, 120);
    store.updateHealth(key, false, 0, 'timeout');

    const health = store.getHealth(key);
    expect(health?.consecutiveFailures).toBe(1);
    expect(health?.lastError).toBe('timeout');
    expect(health?.isHealthy).toBe(false);
  });

  test('updateHealth resets consecutive failures on success', () => {
    const store = new ProviderStatsStore();
    const key = getProviderKey('ethereum', 'moralis');

    store.initializeProvider(key);
    store.updateHealth(key, false, 0, 'error');
    store.updateHealth(key, false, 0, 'error');
    store.updateHealth(key, true, 100);

    expect(store.getHealth(key)?.consecutiveFailures).toBe(0);
    expect(store.getHealth(key)?.isHealthy).toBe(true);
  });

  test('getProviderHealthWithCircuit combines health with circuit state', () => {
    const store = new ProviderStatsStore();
    const key = getProviderKey('ethereum', 'moralis');

    store.initializeProvider(key);

    const result = store.getProviderHealthWithCircuit(key, createInitialCircuitState(), Date.now());
    expect(result).toBeDefined();
    expect(result?.circuitState).toBe('closed');
    expect(result?.isHealthy).toBe(true);
  });

  test('getProviderHealthWithCircuit returns undefined for unknown key', () => {
    const store = new ProviderStatsStore();
    expect(
      store.getProviderHealthWithCircuit('ethereum/unknown' as ProviderKey, createInitialCircuitState(), Date.now())
    ).toBeUndefined();
  });

  test('getHealthMapForProviders filters by blockchain', () => {
    const store = new ProviderStatsStore();

    store.initializeProvider(getProviderKey('ethereum', 'moralis'));
    store.initializeProvider(getProviderKey('bitcoin', 'blockstream'));

    const map = store.getHealthMapForProviders('ethereum', [{ name: 'moralis' }]);

    expect(map.size).toBe(1);
    expect(map.has('moralis')).toBe(true);
    expect(map.has('blockstream')).toBe(false);
  });

  test('getHealthMapForProviders returns empty map when provider has no health entry', () => {
    const store = new ProviderStatsStore();
    const map = store.getHealthMapForProviders('ethereum', [{ name: 'unregistered' }]);
    expect(map.size).toBe(0);
  });

  test('clear resets all health state', () => {
    const store = new ProviderStatsStore();
    const key = getProviderKey('ethereum', 'moralis');

    store.initializeProvider(key);
    store.clear();

    expect(store.hasHealth(key)).toBe(false);
  });
});

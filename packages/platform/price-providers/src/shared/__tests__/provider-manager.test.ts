/**
 * Tests for PriceProviderManager (imperative shell)
 *
 * Tests orchestration, side effects, and integration
 * Pure utility functions are tested in provider-manager-utils.test.ts
 */

/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */

import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PriceProviderManager } from '../provider-manager.ts';
import type { IPriceProvider, PriceData, PriceQuery } from '../types/index.ts';

// Mock logger
vi.mock('@exitbook/shared-logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('PriceProviderManager', () => {
  let manager: PriceProviderManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new PriceProviderManager({
      cacheTtlSeconds: 300,
      defaultCurrency: 'USD',
      maxConsecutiveFailures: 3,
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  function createMockProvider(
    name: string,
    options: {
      fetchBatchResult?: Result<PriceData[], Error>;
      fetchPriceResult?: Result<PriceData, Error>;
      operations?: string[];
      priority?: number;
    } = {}
  ): IPriceProvider {
    const defaultPrice: PriceData = {
      asset: 'BTC',
      currency: 'USD',
      fetchedAt: new Date('2024-01-15T12:00:00Z'),
      price: 50000,
      source: name,
      timestamp: new Date('2024-01-15T12:00:00Z'),
    };

    return {
      fetchBatch: vi.fn(async () =>
        Promise.resolve(options.fetchBatchResult || (ok([defaultPrice]) as Result<PriceData[], Error>))
      ),
      fetchPrice: vi.fn(async () =>
        Promise.resolve(options.fetchPriceResult || (ok(defaultPrice) as Result<PriceData, Error>))
      ),
      getMetadata: () => ({
        capabilities: {
          supportedCurrencies: ['USD'],
          supportedOperations: (options.operations || ['fetchPrice', 'fetchBatch']) as (
            | 'fetchPrice'
            | 'fetchBatch'
            | 'fetchHistoricalRange'
          )[],
        },
        displayName: name,
        name,
        priority: options.priority ?? 1,
        requiresApiKey: false,
      }),
    };
  }

  describe('registerProviders', () => {
    it('should register providers and initialize health/circuit state', () => {
      const provider1 = createMockProvider('provider1');
      const provider2 = createMockProvider('provider2');

      manager.registerProviders([provider1, provider2]);

      const health = manager.getProviderHealth();
      expect(health.size).toBe(2);
      expect(health.get('provider1')).toBeDefined();
      expect(health.get('provider2')).toBeDefined();
    });

    it('should sort providers by priority', async () => {
      const lowPriority = createMockProvider('low', { priority: 5 });
      const highPriority = createMockProvider('high', { priority: 1 });

      manager.registerProviders([lowPriority, highPriority]);

      const query: PriceQuery = { asset: 'BTC', timestamp: new Date() };
      await manager.fetchPrice(query);

      expect(highPriority.fetchPrice).toHaveBeenCalled();
      expect(lowPriority.fetchPrice).not.toHaveBeenCalled();
    });
  });

  describe('fetchPrice with caching', () => {
    it('should fetch price successfully', async () => {
      const provider = createMockProvider('test');
      manager.registerProviders([provider]);

      const result = await manager.fetchPrice({
        asset: 'BTC',
        timestamp: new Date('2024-01-15T12:00:00Z'),
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.data.asset).toBe('BTC');
        expect(result.value.providerName).toBe('test');
      }
    });

    it('should cache results', async () => {
      const provider = createMockProvider('test');
      manager.registerProviders([provider]);

      const query: PriceQuery = {
        asset: 'BTC',
        timestamp: new Date('2024-01-15T12:00:00Z'),
      };

      await manager.fetchPrice(query);
      expect(provider.fetchPrice).toHaveBeenCalledTimes(1);

      await manager.fetchPrice(query);
      expect(provider.fetchPrice).toHaveBeenCalledTimes(1); // Cached
    });

    it('should not use expired cache', async () => {
      const provider = createMockProvider('test');
      manager.registerProviders([provider]);

      const query: PriceQuery = {
        asset: 'BTC',
        timestamp: new Date('2024-01-15T12:00:00Z'),
      };

      await manager.fetchPrice(query);
      vi.advanceTimersByTime(301000); // Past TTL
      await manager.fetchPrice(query);

      expect(provider.fetchPrice).toHaveBeenCalledTimes(2);
    });
  });

  describe('automatic failover', () => {
    it('should failover to next provider on error', async () => {
      const failing = createMockProvider('failing', {
        fetchPriceResult: err(new Error('Failed')),
        priority: 1,
      });
      const working = createMockProvider('working', { priority: 2 });

      manager.registerProviders([failing, working]);

      const result = await manager.fetchPrice({
        asset: 'BTC',
        timestamp: new Date(),
      });

      expect(result.isOk()).toBe(true);
      expect(failing.fetchPrice).toHaveBeenCalled();
      expect(working.fetchPrice).toHaveBeenCalled();
    });

    it('should try all providers before failing', async () => {
      const p1 = createMockProvider('p1', {
        fetchPriceResult: err(new Error('Error 1')),
        priority: 1,
      });
      const p2 = createMockProvider('p2', {
        fetchPriceResult: err(new Error('Error 2')),
        priority: 2,
      });

      manager.registerProviders([p1, p2]);

      const result = await manager.fetchPrice({
        asset: 'BTC',
        timestamp: new Date(),
      });

      expect(result.isErr()).toBe(true);
      expect(p1.fetchPrice).toHaveBeenCalled();
      expect(p2.fetchPrice).toHaveBeenCalled();
    });
  });

  describe('circuit breaker integration', () => {
    it('should skip provider with open circuit', async () => {
      const p1 = createMockProvider('p1', {
        fetchPriceResult: err(new Error('Always fails')),
        priority: 1,
      });
      const p2 = createMockProvider('p2', { priority: 2 });

      manager.registerProviders([p1, p2]);

      // Fail p1 multiple times with different timestamps to avoid caching
      for (let i = 0; i < 5; i++) {
        const query: PriceQuery = {
          asset: 'BTC',
          timestamp: new Date(2024, 0, i + 1),
        };
        await manager.fetchPrice(query);
      }

      // Reset call counts
      vi.clearAllMocks();

      // Next request should skip p1 (open circuit) and use p2
      const result = await manager.fetchPrice({
        asset: 'BTC',
        timestamp: new Date(2024, 0, 10),
      });

      expect(result.isOk()).toBe(true);
      expect(p1.fetchPrice).not.toHaveBeenCalled();
      expect(p2.fetchPrice).toHaveBeenCalled();
    });
  });

  describe('health tracking', () => {
    it('should update health on success', async () => {
      const provider = createMockProvider('test');
      manager.registerProviders([provider]);

      await manager.fetchPrice({ asset: 'BTC', timestamp: new Date() });

      const health = manager.getProviderHealth();
      const testHealth = health.get('test');

      expect(testHealth?.isHealthy).toBe(true);
      expect(testHealth?.consecutiveFailures).toBe(0);
    });

    it('should update health on failure', async () => {
      const provider = createMockProvider('test', {
        fetchPriceResult: err(new Error('Fail')),
      });
      manager.registerProviders([provider]);

      await manager.fetchPrice({ asset: 'BTC', timestamp: new Date() });

      const health = manager.getProviderHealth();
      expect(health.get('test')?.isHealthy).toBe(false);
      expect(health.get('test')?.consecutiveFailures).toBe(1);
    });
  });
});

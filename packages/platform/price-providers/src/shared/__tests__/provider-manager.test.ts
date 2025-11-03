/**
 * Tests for PriceProviderManager (imperative shell)
 *
 * Tests orchestration, side effects, and integration
 * Pure utility functions are tested in provider-manager-utils.test.ts
 */

/* eslint-disable @typescript-eslint/unbound-method -- Acceptable for tests */

import { Currency, parseDecimal } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok, okAsync } from 'neverthrow';
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
      fetchPriceResult?: Result<PriceData, Error>;
      operations?: string[];
    } = {}
  ): IPriceProvider {
    const defaultPrice: PriceData = {
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      fetchedAt: new Date('2024-01-15T12:00:00Z'),
      price: parseDecimal('50000'),
      source: name,
      timestamp: new Date('2024-01-15T12:00:00Z'),
    };

    const mockRateLimit = {
      burstLimit: 1,
      requestsPerHour: 600,
      requestsPerMinute: 10,
      requestsPerSecond: 0.17,
    };

    return {
      fetchPrice: vi.fn(async () =>
        Promise.resolve(options.fetchPriceResult || (ok(defaultPrice) as Result<PriceData, Error>))
      ),
      getMetadata: () => ({
        capabilities: {
          supportedAssetTypes: ['crypto'],
          supportedOperations: (options.operations || ['fetchPrice']) as ('fetchPrice' | 'fetchHistoricalRange')[],
          rateLimit: mockRateLimit,
        },
        displayName: name,
        name,
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

    it('should use first successful provider based on health scoring', async () => {
      const provider1 = createMockProvider('provider1');
      const provider2 = createMockProvider('provider2');

      manager.registerProviders([provider1, provider2]);

      const query: PriceQuery = {
        asset: Currency.create('BTC'),
        timestamp: new Date(),
        currency: Currency.create('USD'),
      };
      await manager.fetchPrice(query);

      // First provider succeeds, so second is not called
      expect(provider1.fetchPrice).toHaveBeenCalled();
      expect(provider2.fetchPrice).not.toHaveBeenCalled();
    });
  });

  describe('fetchPrice with caching', () => {
    it('should fetch price successfully', async () => {
      const provider = createMockProvider('test');
      manager.registerProviders([provider]);

      const result = await manager.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-15T12:00:00Z'),
        currency: Currency.create('USD'),
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.data.asset.toString()).toBe('BTC');
        expect(result.value.providerName).toBe('test');
      }
    });

    it('should cache results', async () => {
      const provider = createMockProvider('test');
      manager.registerProviders([provider]);

      const query: PriceQuery = {
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-15T12:00:00Z'),
        currency: Currency.create('USD'),
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
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-15T12:00:00Z'),
        currency: Currency.create('USD'),
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
      });
      const working = createMockProvider('working');

      manager.registerProviders([failing, working]);

      const result = await manager.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date(),
        currency: Currency.create('USD'),
      });

      expect(result.isOk()).toBe(true);
      expect(failing.fetchPrice).toHaveBeenCalled();
      expect(working.fetchPrice).toHaveBeenCalled();
    });

    it('should try all providers before failing', async () => {
      const p1 = createMockProvider('p1', {
        fetchPriceResult: err(new Error('Error 1')),
      });
      const p2 = createMockProvider('p2', {
        fetchPriceResult: err(new Error('Error 2')),
      });

      manager.registerProviders([p1, p2]);

      const result = await manager.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date(),
        currency: Currency.create('USD'),
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
      });
      const p2 = createMockProvider('p2');

      manager.registerProviders([p1, p2]);

      // Fail p1 multiple times with different timestamps to avoid caching
      for (let i = 0; i < 5; i++) {
        const query: PriceQuery = {
          asset: Currency.create('BTC'),
          timestamp: new Date(2024, 0, i + 1),
          currency: Currency.create('USD'),
        };
        await manager.fetchPrice(query);
      }

      // Reset call counts
      vi.clearAllMocks();

      // Next request should skip p1 (open circuit) and use p2
      const result = await manager.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date(2024, 0, 10),
        currency: Currency.create('USD'),
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

      await manager.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date(),
        currency: Currency.create('USD'),
      });

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

      await manager.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date(),
        currency: Currency.create('USD'),
      });

      const health = manager.getProviderHealth();
      expect(health.get('test')?.isHealthy).toBe(false);
      expect(health.get('test')?.consecutiveFailures).toBe(1);
    });
  });

  describe('stablecoin conversion', () => {
    it('should convert USDT-denominated price to USD', async () => {
      // Provider returns BTC price in USDT
      const btcInUsdt: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USDT'), // Stablecoin
        fetchedAt: new Date('2024-01-15T12:00:00Z'),
        price: parseDecimal('50000'),
        source: 'binance',
        timestamp: new Date('2024-01-15T12:00:00Z'),
      };

      // USDT is priced at $0.99 (slight de-peg)
      const usdtInUsd: PriceData = {
        asset: Currency.create('USDT'),
        currency: Currency.create('USD'),
        fetchedAt: new Date('2024-01-15T12:00:00Z'),
        price: parseDecimal('0.99'),
        source: 'coingecko',
        timestamp: new Date('2024-01-15T12:00:00Z'),
      };

      const provider = {
        fetchPrice: vi.fn(async (query: PriceQuery) => {
          if (query.asset.toString() === 'BTC') {
            return ok(btcInUsdt);
          }
          if (query.asset.toString() === 'USDT') {
            return okAsync(usdtInUsd);
          }
          return err(new Error('Unknown asset'));
        }),
        getMetadata: () => ({
          capabilities: {
            supportedAssetTypes: ['crypto'] as ('crypto' | 'fiat')[],
            supportedOperations: ['fetchPrice'] as ('fetchPrice' | 'fetchHistoricalRange')[],
            rateLimit: {
              burstLimit: 1,
              requestsPerHour: 600,
              requestsPerMinute: 10,
              requestsPerSecond: 0.17,
            },
          },
          displayName: 'test',
          name: 'test',
          requiresApiKey: false,
        }),
      };

      manager.registerProviders([provider]);

      const result = await manager.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-15T12:00:00Z'),
        currency: Currency.create('USD'),
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // BTC price should be converted: 50000 USDT * 0.99 USD/USDT = 49500 USD
        expect(result.value.data.currency.toString()).toBe('USD');
        expect(result.value.data.price.toFixed()).toBe('49500');
        expect(result.value.data.source).toBe('binance+usdt-rate');
      }

      // Should have fetched both BTC and USDT prices
      expect(provider.fetchPrice).toHaveBeenCalledTimes(2);
    });

    it('should not convert when pricing a stablecoin itself', async () => {
      // Pricing USDT directly in USD
      const usdtInUsd: PriceData = {
        asset: Currency.create('USDT'),
        currency: Currency.create('USDT'), // Same as asset
        fetchedAt: new Date('2024-01-15T12:00:00Z'),
        price: parseDecimal('1.0'),
        source: 'coingecko',
        timestamp: new Date('2024-01-15T12:00:00Z'),
      };

      const provider = createMockProvider('test', {
        fetchPriceResult: ok(usdtInUsd),
      });

      manager.registerProviders([provider]);

      const result = await manager.fetchPrice({
        asset: Currency.create('USDT'),
        timestamp: new Date('2024-01-15T12:00:00Z'),
        currency: Currency.create('USD'),
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should NOT convert (would cause infinite recursion)
        // Returns as-is with USDT currency
        expect(result.value.data.currency.toString()).toBe('USDT');
      }

      // Should only fetch once (no recursive call)
      expect(provider.fetchPrice).toHaveBeenCalledTimes(1);
    });

    it('should assume 1:1 parity when stablecoin rate unavailable', async () => {
      // Provider returns BTC price in USDC
      const btcInUsdc: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USDC'), // Stablecoin
        fetchedAt: new Date('2024-01-15T12:00:00Z'),
        price: parseDecimal('50000'),
        source: 'binance',
        timestamp: new Date('2024-01-15T12:00:00Z'),
      };

      const provider = {
        fetchPrice: vi.fn(async (query: PriceQuery) => {
          if (query.asset.toString() === 'BTC') {
            return okAsync(btcInUsdc);
          }
          if (query.asset.toString() === 'USDC') {
            return err(new Error('USDC rate not available'));
          }
          return err(new Error('Unknown asset'));
        }),
        getMetadata: () => ({
          capabilities: {
            supportedAssetTypes: ['crypto'] as ('crypto' | 'fiat')[],
            supportedOperations: ['fetchPrice'] as ('fetchPrice' | 'fetchHistoricalRange')[],
            rateLimit: {
              burstLimit: 1,
              requestsPerHour: 600,
              requestsPerMinute: 10,
              requestsPerSecond: 0.17,
            },
          },
          displayName: 'test',
          name: 'test',
          requiresApiKey: false,
        }),
      };

      manager.registerProviders([provider]);

      const result = await manager.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-15T12:00:00Z'),
        currency: Currency.create('USD'),
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should fallback to 1:1 parity
        expect(result.value.data.currency.toString()).toBe('USD');
        expect(result.value.data.price.toFixed()).toBe('50000');
        expect(result.value.data.source).toBe('binance+assumed-usdc-parity');
      }
    });
  });
});

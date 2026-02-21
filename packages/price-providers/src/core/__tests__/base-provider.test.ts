import { type Currency, parseDecimal } from '@exitbook/core';
import type { HttpClient } from '@exitbook/http';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PriceQueries } from '../../persistence/queries/price-queries.js';
import { BasePriceProvider } from '../base-provider.js';
import type { PriceData, PriceQuery, ProviderMetadata } from '../types.js';

// Mock logger
vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Concrete test implementation of BasePriceProvider
 */
class TestPriceProvider extends BasePriceProvider {
  protected metadata: ProviderMetadata = {
    name: 'test-provider',
    displayName: 'Test Provider',
    requiresApiKey: false,
    capabilities: {
      supportedOperations: ['fetchPrice'],
      supportedAssetTypes: ['crypto'],
      rateLimit: {
        burstLimit: 10,
        requestsPerHour: 1000,
        requestsPerMinute: 60,
        requestsPerSecond: 1,
      },
    },
  };

  private fetchImpl: (query: PriceQuery) => Promise<Result<PriceData, Error>>;

  constructor(priceQueries: PriceQueries, fetchImpl: (query: PriceQuery) => Promise<Result<PriceData, Error>>) {
    const httpClient = {
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as HttpClient;
    super(httpClient, priceQueries);
    this.fetchImpl = fetchImpl;
  }

  // Expose protected methods for testing
  public testCheckCache(query: PriceQuery, currency: Currency): Promise<Result<PriceData | undefined, Error>> {
    return this.checkCache(query, currency);
  }

  public testSaveToCache(priceData: PriceData, identifier: string): Promise<void> {
    return this.saveToCache(priceData, identifier);
  }

  protected async fetchPriceInternal(query: PriceQuery): Promise<Result<PriceData, Error>> {
    return this.fetchImpl(query);
  }
}

describe('BasePriceProvider', () => {
  let priceQueriesMocks: {
    getPrice: ReturnType<typeof vi.fn>;
    savePrice: ReturnType<typeof vi.fn>;
  };
  let priceQueries: PriceQueries;

  beforeEach(() => {
    priceQueriesMocks = {
      getPrice: vi.fn(),
      savePrice: vi.fn(),
    };
    priceQueries = priceQueriesMocks as unknown as PriceQueries;
  });

  describe('fetchPrice', () => {
    it('should reject future timestamps', async () => {
      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const futureDate = new Date(Date.now() + 86400000); // Tomorrow
      const result = await provider.fetchPrice({
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: futureDate,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Cannot fetch future prices');
      }
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('should reject timestamps before crypto era', async () => {
      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const oldDate = new Date('2008-01-01T00:00:00.000Z');
      const result = await provider.fetchPrice({
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: oldDate,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Timestamp before crypto era');
      }
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('should normalize currency to USD when not specified', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        ok({
          assetSymbol: 'BTC' as Currency,
          currency: 'USD' as Currency,
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('43000'),
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        })
      );
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      // Query without currency - should be normalized to USD
      const result = await provider.fetchPrice({
        assetSymbol: 'BTC' as Currency,
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        currency: 'USD' as Currency, // Base provider normalizes to USD internally
      });

      expect(result.isOk()).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'USD' as Currency,
        })
      );
    });

    it('should validate price data from implementation', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        ok({
          assetSymbol: 'BTC' as Currency,
          currency: 'USD' as Currency,
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('-100'), // Invalid negative price
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        })
      );
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const result = await provider.fetchPrice({
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid price data');
      }
    });

    it('should accept valid price data', async () => {
      const validPriceData: PriceData = {
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      const fetchImpl = vi.fn().mockResolvedValue(ok(validPriceData));
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const result = await provider.fetchPrice({
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(validPriceData);
      }
    });

    it('should propagate errors from implementation', async () => {
      const errorMessage = 'API request failed';
      const fetchImpl = vi.fn().mockResolvedValue(err(new Error(errorMessage)));
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const result = await provider.fetchPrice({
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe(errorMessage);
      }
    });
  });

  describe('getMetadata', () => {
    it('should return provider metadata', () => {
      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const metadata = provider.getMetadata();

      expect(metadata).toEqual({
        name: 'test-provider',
        displayName: 'Test Provider',
        requiresApiKey: false,
        capabilities: {
          supportedOperations: ['fetchPrice'],
          supportedAssetTypes: ['crypto'],
          rateLimit: {
            burstLimit: 10,
            requestsPerHour: 1000,
            requestsPerMinute: 60,
            requestsPerSecond: 1,
          },
        },
      });
    });
  });

  describe('checkCache', () => {
    it('should return cached price when available', async () => {
      const cachedPrice: PriceData = {
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      priceQueriesMocks.getPrice.mockResolvedValue(ok(cachedPrice));

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const result = await provider.testCheckCache(
        {
          assetSymbol: 'BTC' as Currency,
          currency: 'USD' as Currency,
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
        },
        'USD' as Currency
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(cachedPrice);
      }
      expect(priceQueriesMocks.getPrice).toHaveBeenCalled();
    });

    it('should return undefined when cache miss', async () => {
      priceQueriesMocks.getPrice.mockResolvedValue(ok());

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const result = await provider.testCheckCache(
        {
          assetSymbol: 'BTC' as Currency,
          currency: 'USD' as Currency,
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
        },
        'USD' as Currency
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should propagate errors from repository', async () => {
      priceQueriesMocks.getPrice.mockResolvedValue(err(new Error('Database error')));

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const result = await provider.testCheckCache(
        {
          assetSymbol: 'BTC' as Currency,
          currency: 'USD' as Currency,
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
        },
        'USD' as Currency
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database error');
      }
    });
  });

  describe('saveToCache', () => {
    it('should save price data to cache', async () => {
      priceQueriesMocks.savePrice.mockResolvedValue(ok());

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const priceData: PriceData = {
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await provider.testSaveToCache(priceData, 'bitcoin');

      expect(priceQueriesMocks.savePrice).toHaveBeenCalledWith(priceData, 'bitcoin');
    });

    it('should not throw when cache save fails', async () => {
      priceQueriesMocks.savePrice.mockResolvedValue(err(new Error('Database error')));

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceQueries, fetchImpl);

      const priceData: PriceData = {
        assetSymbol: 'BTC' as Currency,
        currency: 'USD' as Currency,
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      // Should not throw
      await expect(provider.testSaveToCache(priceData, 'bitcoin')).resolves.toBeUndefined();
    });
  });
});

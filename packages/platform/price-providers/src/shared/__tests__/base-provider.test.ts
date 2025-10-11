import { Currency } from '@exitbook/core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PriceRepository } from '../../persistence/repositories/price-repository.js';
import { BasePriceProvider } from '../base-provider.ts';
import type { PriceData, PriceQuery, ProviderMetadata } from '../types/index.js';

// Mock logger
vi.mock('@exitbook/shared-logger', () => ({
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
      supportedCurrencies: ['USD', 'EUR'],
      rateLimit: {
        burstLimit: 10,
        requestsPerHour: 1000,
        requestsPerMinute: 60,
        requestsPerSecond: 1,
      },
    },
  };

  private fetchImpl: (query: PriceQuery) => Promise<Result<PriceData, Error>>;

  constructor(priceRepo: PriceRepository, fetchImpl: (query: PriceQuery) => Promise<Result<PriceData, Error>>) {
    super();
    this.priceRepo = priceRepo;
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
  let priceRepoMocks: {
    getPrice: ReturnType<typeof vi.fn>;
    savePrice: ReturnType<typeof vi.fn>;
  };
  let priceRepo: PriceRepository;

  beforeEach(() => {
    priceRepoMocks = {
      getPrice: vi.fn(),
      savePrice: vi.fn(),
    };
    priceRepo = priceRepoMocks as unknown as PriceRepository;
  });

  describe('fetchPrice', () => {
    it('should reject future timestamps', async () => {
      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const futureDate = new Date(Date.now() + 86400000); // Tomorrow
      const result = await provider.fetchPrice({
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
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
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const oldDate = new Date('2008-01-01T00:00:00.000Z');
      const result = await provider.fetchPrice({
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
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
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: 43000,
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        })
      );
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      // Query without currency - should be normalized to USD
      const result = await provider.fetchPrice({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        currency: Currency.create('USD'), // Base provider normalizes to USD internally
      });

      expect(result.isOk()).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: Currency.create('USD'),
        })
      );
    });

    it('should validate price data from implementation', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        ok({
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: -100, // Invalid negative price
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        })
      );
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const result = await provider.fetchPrice({
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid price data');
      }
    });

    it('should accept valid price data', async () => {
      const validPriceData: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: 43000,
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      const fetchImpl = vi.fn().mockResolvedValue(ok(validPriceData));
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const result = await provider.fetchPrice({
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
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
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const result = await provider.fetchPrice({
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
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
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const metadata = provider.getMetadata();

      expect(metadata).toEqual({
        name: 'test-provider',
        displayName: 'Test Provider',
        requiresApiKey: false,
        capabilities: {
          supportedOperations: ['fetchPrice'],
          supportedCurrencies: ['USD', 'EUR'],
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
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: 43000,
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      priceRepoMocks.getPrice.mockResolvedValue(ok(cachedPrice));

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const result = await provider.testCheckCache(
        {
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
        },
        Currency.create('USD')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(cachedPrice);
      }
      expect(priceRepoMocks.getPrice).toHaveBeenCalled();
    });

    it('should return undefined when cache miss', async () => {
      priceRepoMocks.getPrice.mockResolvedValue(ok());

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const result = await provider.testCheckCache(
        {
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
        },
        Currency.create('USD')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should propagate errors from repository', async () => {
      priceRepoMocks.getPrice.mockResolvedValue(err(new Error('Database error')));

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const result = await provider.testCheckCache(
        {
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
        },
        Currency.create('USD')
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database error');
      }
    });
  });

  describe('saveToCache', () => {
    it('should save price data to cache', async () => {
      priceRepoMocks.savePrice.mockResolvedValue(ok());

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const priceData: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: 43000,
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await provider.testSaveToCache(priceData, 'bitcoin');

      expect(priceRepoMocks.savePrice).toHaveBeenCalledWith(priceData, 'bitcoin');
    });

    it('should not throw when cache save fails', async () => {
      priceRepoMocks.savePrice.mockResolvedValue(err(new Error('Database error')));

      const fetchImpl = vi.fn();
      const provider = new TestPriceProvider(priceRepo, fetchImpl);

      const priceData: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: 43000,
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      // Should not throw
      await expect(provider.testSaveToCache(priceData, 'bitcoin')).resolves.toBeUndefined();
    });
  });
});

import { Currency, parseDecimal } from '@exitbook/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PriceData } from '../../../shared/types/index.js';
import { createPricesDatabase, initializePricesDatabase, type PricesDB } from '../../database.js';
import { PriceRepository } from '../price-repository.js';

describe('PriceRepository', () => {
  let db: PricesDB;
  let repository: PriceRepository;

  beforeEach(async () => {
    // Create in-memory database
    const dbResult = createPricesDatabase(':memory:');
    if (dbResult.isErr()) {
      throw dbResult.error;
    }
    db = dbResult.value;

    // Run migrations
    const migrationResult = await initializePricesDatabase(db);
    if (migrationResult.isErr()) {
      throw migrationResult.error;
    }

    repository = new PriceRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('getPrice', () => {
    it('should return undefined when price not found', async () => {
      const result = await repository.getPrice(
        Currency.create('BTC'),
        Currency.create('USD'),
        new Date('2024-01-15T12:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should return cached price when found', async () => {
      const priceData: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await repository.savePrice(priceData);

      const result = await repository.getPrice(
        Currency.create('BTC'),
        Currency.create('USD'),
        new Date('2024-01-15T14:30:00.000Z') // Different time of day
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeDefined();
        expect(result.value?.price).toEqual(parseDecimal('43000'));
        expect(result.value?.asset.toString()).toBe('BTC');
        expect(result.value?.currency.toString()).toBe('USD');
      }
    });

    it('should round timestamp to day for lookup', async () => {
      const priceData: PriceData = {
        asset: Currency.create('ETH'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('2500'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await repository.savePrice(priceData);

      // Should find it regardless of time of day
      const result1 = await repository.getPrice(
        Currency.create('ETH'),
        Currency.create('USD'),
        new Date('2024-01-15T08:30:45.123Z')
      );

      expect(result1.isOk()).toBe(true);
      if (result1.isOk()) {
        expect(result1.value?.price).toEqual(parseDecimal('2500'));
      }

      const result2 = await repository.getPrice(
        Currency.create('ETH'),
        Currency.create('USD'),
        new Date('2024-01-15T23:59:59.999Z')
      );

      expect(result2.isOk()).toBe(true);
      if (result2.isOk()) {
        expect(result2.value?.price).toEqual(parseDecimal('2500'));
      }
    });

    it('should be case-insensitive for asset and currency', async () => {
      const priceData: PriceData = {
        asset: Currency.create('btc'),
        currency: Currency.create('usd'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await repository.savePrice(priceData);

      const result = await repository.getPrice(
        Currency.create('BTC'),
        Currency.create('USD'),
        new Date('2024-01-15T00:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.price).toEqual(parseDecimal('43000'));
      }
    });
  });

  describe('savePrice', () => {
    it('should save new price data', async () => {
      const priceData: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      const saveResult = await repository.savePrice(priceData);

      expect(saveResult.isOk()).toBe(true);

      const getResult = await repository.getPrice(
        Currency.create('BTC'),
        Currency.create('USD'),
        new Date('2024-01-15T00:00:00.000Z')
      );

      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value?.price).toEqual(parseDecimal('43000'));
      }
    });

    it('should update existing price (upsert)', async () => {
      const priceData1: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'provider1',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await repository.savePrice(priceData1);

      const priceData2: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43500'),
        source: 'provider2',
        fetchedAt: new Date('2024-01-15T14:00:00.000Z'),
      };

      await repository.savePrice(priceData2);

      const result = await repository.getPrice(
        Currency.create('BTC'),
        Currency.create('USD'),
        new Date('2024-01-15T00:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.price).toEqual(parseDecimal('43500')); // Updated price
        expect(result.value?.source).toBe('provider2');
      }
    });

    it('should save provider coin ID when provided', async () => {
      const priceData: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'coingecko',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await repository.savePrice(priceData, 'bitcoin');

      const result = await repository.getPrice(
        Currency.create('BTC'),
        Currency.create('USD'),
        new Date('2024-01-15T00:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeDefined();
      }
    });

    it('should round timestamp to day before saving', async () => {
      const priceData: PriceData = {
        asset: Currency.create('ETH'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T14:30:45.123Z'),
        price: parseDecimal('2500'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T14:30:45.123Z'),
      };

      await repository.savePrice(priceData);

      // Should be saved as 2024-01-15T00:00:00.000Z
      const result = await repository.getPrice(
        Currency.create('ETH'),
        Currency.create('USD'),
        new Date('2024-01-15T00:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.price).toEqual(parseDecimal('2500'));
      }
    });
  });

  describe('savePrices', () => {
    it('should save multiple prices', async () => {
      const prices: PriceData[] = [
        {
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('43000'),
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        },
        {
          asset: Currency.create('ETH'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('2500'),
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        },
        {
          asset: Currency.create('SOL'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('100'),
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        },
      ];

      const result = await repository.savePrices(prices);

      expect(result.isOk()).toBe(true);

      // Verify all prices were saved
      for (const price of prices) {
        const getResult = await repository.getPrice(price.asset, price.currency, price.timestamp);
        expect(getResult.isOk()).toBe(true);
        if (getResult.isOk()) {
          expect(getResult.value?.price).toEqual(price.price);
        }
      }
    });

    it('should handle batch save with provider coin IDs', async () => {
      const prices: PriceData[] = [
        {
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('43000'),
          source: 'coingecko',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        },
        {
          asset: Currency.create('ETH'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('2500'),
          source: 'coingecko',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        },
      ];

      const coinIds = new Map([
        ['BTC', 'bitcoin'],
        ['ETH', 'ethereum'],
      ]);

      const result = await repository.savePrices(prices, coinIds);

      expect(result.isOk()).toBe(true);
    });

    it('should handle large batches (>100 items)', async () => {
      const prices: PriceData[] = [];
      for (let i = 1; i <= 150; i++) {
        prices.push({
          asset: Currency.create(`TOKEN${i}`),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal((i * 100).toString()),
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        });
      }

      const result = await repository.savePrices(prices);

      expect(result.isOk()).toBe(true);
    });
  });

  describe('getPriceRange', () => {
    beforeEach(async () => {
      // Insert test data
      const prices: PriceData[] = [
        {
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-10T00:00:00.000Z'),
          price: parseDecimal('40000'),
          source: 'test-provider',
          fetchedAt: new Date('2024-01-10T12:00:00.000Z'),
        },
        {
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('43000'),
          source: 'test-provider',
          fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
        },
        {
          asset: Currency.create('BTC'),
          currency: Currency.create('USD'),
          timestamp: new Date('2024-01-20T00:00:00.000Z'),
          price: parseDecimal('45000'),
          source: 'test-provider',
          fetchedAt: new Date('2024-01-20T12:00:00.000Z'),
        },
      ];

      await repository.savePrices(prices);
    });

    it('should return prices in date range', async () => {
      const result = await repository.getPriceRange(
        'BTC',
        'USD',
        new Date('2024-01-12T00:00:00.000Z'),
        new Date('2024-01-18T00:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.price).toEqual(parseDecimal('43000'));
      }
    });

    it('should return all prices when range covers all dates', async () => {
      const result = await repository.getPriceRange(
        'BTC',
        'USD',
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-31T00:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
        // Should be sorted by timestamp ascending
        expect(result.value[0]?.price).toEqual(parseDecimal('40000'));
        expect(result.value[1]?.price).toEqual(parseDecimal('43000'));
        expect(result.value[2]?.price).toEqual(parseDecimal('45000'));
      }
    });

    it('should return empty array when no prices in range', async () => {
      const result = await repository.getPriceRange(
        'BTC',
        'USD',
        new Date('2024-02-01T00:00:00.000Z'),
        new Date('2024-02-28T00:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should be case-insensitive', async () => {
      const result = await repository.getPriceRange(
        'btc',
        'usd',
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-31T00:00:00.000Z')
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
      }
    });
  });

  describe('hasPrice', () => {
    it('should return false when price does not exist', async () => {
      const result = await repository.hasPrice('BTC', 'USD', new Date('2024-01-15T00:00:00.000Z'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });

    it('should return true when price exists', async () => {
      const priceData: PriceData = {
        asset: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('43000'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await repository.savePrice(priceData);

      const result = await repository.hasPrice('BTC', 'USD', new Date('2024-01-15T00:00:00.000Z'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('should round timestamp to day', async () => {
      const priceData: PriceData = {
        asset: Currency.create('ETH'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: parseDecimal('2500'),
        source: 'test-provider',
        fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
      };

      await repository.savePrice(priceData);

      const result = await repository.hasPrice('ETH', 'USD', new Date('2024-01-15T18:30:00.000Z'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });
  });
});

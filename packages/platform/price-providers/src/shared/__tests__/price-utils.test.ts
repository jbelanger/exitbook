import { describe, expect, it } from 'vitest';

import {
  calculatePriceChange,
  createCacheKey,
  deduplicatePrices,
  formatPrice,
  isSameDay,
  normalizeAssetSymbol,
  normalizeCurrency,
  roundToDay,
  sortByTimestamp,
  validatePriceData,
  validateQueryTimeRange,
} from '../price-utils.ts';
import type { PriceData, PriceQuery } from '../types/index.ts';

describe('normalizeAssetSymbol', () => {
  it('should convert to uppercase', () => {
    expect(normalizeAssetSymbol('btc')).toBe('BTC');
    expect(normalizeAssetSymbol('eth')).toBe('ETH');
  });

  it('should trim whitespace', () => {
    expect(normalizeAssetSymbol(' BTC ')).toBe('BTC');
  });

  it('should handle aliases', () => {
    expect(normalizeAssetSymbol('weth')).toBe('ETH');
    expect(normalizeAssetSymbol('WBTC')).toBe('BTC');
  });
});

describe('normalizeCurrency', () => {
  it('should convert to uppercase', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency('eur')).toBe('EUR');
  });

  it('should trim whitespace', () => {
    expect(normalizeCurrency(' USD ')).toBe('USD');
  });
});

describe('roundToDay', () => {
  it('should round down to start of day in UTC', () => {
    const date = new Date('2024-01-15T14:30:45.123Z');
    const rounded = roundToDay(date);

    expect(rounded.toISOString()).toBe('2024-01-15T00:00:00.000Z');
  });

  it('should not modify dates already at start of day', () => {
    const date = new Date('2024-01-15T00:00:00.000Z');
    const rounded = roundToDay(date);

    expect(rounded.toISOString()).toBe('2024-01-15T00:00:00.000Z');
  });
});

describe('isSameDay', () => {
  it('should return true for dates on same day', () => {
    const date1 = new Date('2024-01-15T10:00:00.000Z');
    const date2 = new Date('2024-01-15T20:00:00.000Z');

    expect(isSameDay(date1, date2)).toBe(true);
  });

  it('should return false for dates on different days', () => {
    const date1 = new Date('2024-01-15T23:59:59.999Z');
    const date2 = new Date('2024-01-16T00:00:00.000Z');

    expect(isSameDay(date1, date2)).toBe(false);
  });
});

describe('validatePriceData', () => {
  const validData: PriceData = {
    asset: 'BTC',
    timestamp: new Date('2024-01-15T00:00:00.000Z'),
    price: 43000,
    currency: 'USD',
    source: 'test',
    fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
  };

  it('should return undefined for valid price data', () => {
    expect(validatePriceData(validData)).toBeUndefined();
  });

  it('should reject negative prices', () => {
    const invalid = { ...validData, price: -100 };
    expect(validatePriceData(invalid)).toContain('Invalid price');
  });

  it('should reject zero prices', () => {
    const invalid = { ...validData, price: 0 };
    expect(validatePriceData(invalid)).toContain('Invalid price');
  });

  it('should reject unreasonably high prices', () => {
    const invalid = { ...validData, price: 1e13 };
    expect(validatePriceData(invalid)).toContain('Suspicious price');
  });

  it('should reject future timestamps', () => {
    const futureDate = new Date(Date.now() + 86400000); // Tomorrow
    const invalid = { ...validData, timestamp: futureDate, fetchedAt: futureDate };
    expect(validatePriceData(invalid)).toContain('future date');
  });

  it('should reject fetched before timestamp', () => {
    const invalid = {
      ...validData,
      timestamp: new Date('2024-01-15T12:00:00.000Z'),
      fetchedAt: new Date('2024-01-15T00:00:00.000Z'),
    };
    expect(validatePriceData(invalid)).toContain('Invalid fetch time');
  });
});

describe('createCacheKey', () => {
  it('should create consistent cache keys', () => {
    const query: PriceQuery = {
      asset: 'BTC',
      timestamp: new Date('2024-01-15T14:30:00.000Z'),
      currency: 'USD',
    };

    const key = createCacheKey(query);
    expect(key).toBe('BTC:USD:1705276800000'); // Rounded to start of day
  });

  it('should normalize asset and currency', () => {
    const query: PriceQuery = {
      asset: 'btc',
      timestamp: new Date('2024-01-15T00:00:00.000Z'),
      currency: 'usd',
    };

    expect(createCacheKey(query)).toBe('BTC:USD:1705276800000');
  });

  it('should default to USD if currency not specified', () => {
    const query: PriceQuery = {
      asset: 'ETH',
      timestamp: new Date('2024-01-15T00:00:00.000Z'),
    };

    expect(createCacheKey(query)).toBe('ETH:USD:1705276800000');
  });
});

describe('sortByTimestamp', () => {
  it('should sort prices by timestamp ascending', () => {
    const prices: PriceData[] = [
      {
        asset: 'BTC',
        timestamp: new Date('2024-01-17T00:00:00.000Z'),
        price: 45000,
        currency: 'USD',
        source: 'test',
        fetchedAt: new Date(),
      },
      {
        asset: 'BTC',
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: 43000,
        currency: 'USD',
        source: 'test',
        fetchedAt: new Date(),
      },
      {
        asset: 'BTC',
        timestamp: new Date('2024-01-16T00:00:00.000Z'),
        price: 44000,
        currency: 'USD',
        source: 'test',
        fetchedAt: new Date(),
      },
    ];

    const sorted = sortByTimestamp(prices);

    expect(sorted).toHaveLength(3);
    expect(sorted[0]?.price).toBe(43000);
    expect(sorted[1]?.price).toBe(44000);
    expect(sorted[2]?.price).toBe(45000);
  });

  it('should not mutate original array', () => {
    const prices: PriceData[] = [
      {
        asset: 'BTC',
        timestamp: new Date('2024-01-17T00:00:00.000Z'),
        price: 45000,
        currency: 'USD',
        source: 'test',
        fetchedAt: new Date(),
      },
    ];

    const sorted = sortByTimestamp(prices);
    expect(sorted).not.toBe(prices);
  });
});

describe('deduplicatePrices', () => {
  it('should keep most recently fetched price for duplicates', () => {
    const oldFetch = new Date('2024-01-15T10:00:00.000Z');
    const newFetch = new Date('2024-01-15T12:00:00.000Z');
    const timestamp = new Date('2024-01-15T00:00:00.000Z');

    const prices: PriceData[] = [
      {
        asset: 'BTC',
        timestamp,
        price: 43000,
        currency: 'USD',
        source: 'provider1',
        fetchedAt: oldFetch,
      },
      {
        asset: 'BTC',
        timestamp,
        price: 43100,
        currency: 'USD',
        source: 'provider2',
        fetchedAt: newFetch,
      },
    ];

    const deduplicated = deduplicatePrices(prices);

    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0]?.price).toBe(43100);
    expect(deduplicated[0]?.source).toBe('provider2');
  });
});

describe('calculatePriceChange', () => {
  it('should calculate percentage change', () => {
    expect(calculatePriceChange(100, 110)).toBe(10);
    expect(calculatePriceChange(100, 90)).toBe(-10);
  });

  it('should handle zero old price', () => {
    expect(calculatePriceChange(0, 100)).toBe(0);
  });
});

describe('formatPrice', () => {
  it('should use 2 decimals for prices >= 1', () => {
    expect(formatPrice(43000)).toBe('USD 43000.00');
    expect(formatPrice(1.5)).toBe('USD 1.50');
  });

  it('should use 6 decimals for prices < 1', () => {
    expect(formatPrice(0.5)).toBe('USD 0.500000');
  });

  it('should use 8 decimals for prices < 0.01', () => {
    expect(formatPrice(0.00012345)).toBe('USD 0.00012345');
  });

  it('should support custom currency', () => {
    expect(formatPrice(100, 'EUR')).toBe('EUR 100.00');
  });
});

describe('validateQueryTimeRange', () => {
  it('should return undefined for valid dates', () => {
    const validDate = new Date('2023-01-15T00:00:00.000Z');
    expect(validateQueryTimeRange(validDate)).toBeUndefined();
  });

  it('should reject future dates', () => {
    const futureDate = new Date(Date.now() + 86400000);
    expect(validateQueryTimeRange(futureDate)).toContain('future prices');
  });

  it('should reject dates before Bitcoin genesis', () => {
    const oldDate = new Date('2008-01-01T00:00:00.000Z');
    expect(validateQueryTimeRange(oldDate)).toContain('before crypto era');
  });
});

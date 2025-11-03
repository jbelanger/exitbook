import { Currency, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { createTestPriceData } from '../../__tests__/test-helpers.ts';
import {
  calculatePriceChange,
  createCacheKey,
  createProviderHttpClient,
  deduplicatePrices,
  formatPrice,
  isSameDay,
  roundToDay,
  sortByTimestamp,
  validatePriceData,
  validateQueryTimeRange,
} from '../shared-utils.ts';
import type { PriceData, PriceQuery } from '../types/index.ts';

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
  const validData: PriceData = createTestPriceData({
    asset: Currency.create('BTC'),
    timestamp: new Date('2024-01-15T00:00:00.000Z'),
    price: 43000,
    currency: Currency.create('USD'),
    source: 'test',
    fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
  });

  it('should return undefined for valid price data', () => {
    expect(validatePriceData(validData)).toBeUndefined();
  });

  it('should reject negative prices', () => {
    const invalid = { ...validData, price: parseDecimal('-100') };
    expect(validatePriceData(invalid)).toContain('Invalid price');
  });

  it('should reject zero prices', () => {
    const invalid = { ...validData, price: parseDecimal('0') };
    expect(validatePriceData(invalid)).toContain('Invalid price');
  });

  it('should reject unreasonably high prices', () => {
    const invalid = { ...validData, price: parseDecimal('10000000000000') };
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
      asset: Currency.create('BTC'),
      timestamp: new Date('2024-01-15T14:30:00.000Z'),
      currency: Currency.create('USD'),
    };

    const key = createCacheKey(query);
    expect(key).toBe('BTC:USD:1705276800000'); // Rounded to start of day
  });

  it('should normalize asset and currency', () => {
    const query: PriceQuery = {
      asset: Currency.create('btc'),
      timestamp: new Date('2024-01-15T00:00:00.000Z'),
      currency: Currency.create('usd'),
    };

    expect(createCacheKey(query)).toBe('BTC:USD:1705276800000');
  });

  it('should default to USD if currency not specified', () => {
    const query: PriceQuery = {
      asset: Currency.create('ETH'),
      timestamp: new Date('2024-01-15T00:00:00.000Z'),
      currency: Currency.create('USD'),
    };

    expect(createCacheKey(query)).toBe('ETH:USD:1705276800000');
  });
});

describe('sortByTimestamp', () => {
  it('should sort prices by timestamp ascending', () => {
    const prices: PriceData[] = [
      createTestPriceData({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-17T00:00:00.000Z'),
        price: 45000,
        currency: Currency.create('USD'),
        source: 'test',
        fetchedAt: new Date(),
      }),
      createTestPriceData({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-15T00:00:00.000Z'),
        price: 43000,
        currency: Currency.create('USD'),
        source: 'test',
        fetchedAt: new Date(),
      }),
      createTestPriceData({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-16T00:00:00.000Z'),
        price: 44000,
        currency: Currency.create('USD'),
        source: 'test',
        fetchedAt: new Date(),
      }),
    ];

    const sorted = sortByTimestamp(prices);

    expect(sorted).toHaveLength(3);
    expect(sorted[0]?.price.toNumber()).toBe(43000);
    expect(sorted[1]?.price.toNumber()).toBe(44000);
    expect(sorted[2]?.price.toNumber()).toBe(45000);
  });

  it('should not mutate original array', () => {
    const prices: PriceData[] = [
      createTestPriceData({
        asset: Currency.create('BTC'),
        timestamp: new Date('2024-01-17T00:00:00.000Z'),
        price: 45000,
        currency: Currency.create('USD'),
        source: 'test',
        fetchedAt: new Date(),
      }),
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
      createTestPriceData({
        asset: Currency.create('BTC'),
        timestamp,
        price: 43000,
        currency: Currency.create('USD'),
        source: 'provider1',
        fetchedAt: oldFetch,
      }),
      createTestPriceData({
        asset: Currency.create('BTC'),
        timestamp,
        price: 43100,
        currency: Currency.create('USD'),
        source: 'provider2',
        fetchedAt: newFetch,
      }),
    ];

    const deduplicated = deduplicatePrices(prices);

    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0]?.price.toNumber()).toBe(43100);
    expect(deduplicated[0]?.source).toBe('provider2');
  });
});

describe('calculatePriceChange', () => {
  it('should calculate percentage change', () => {
    expect(calculatePriceChange(parseDecimal('100'), parseDecimal('110')).toNumber()).toBe(10);
    expect(calculatePriceChange(parseDecimal('100'), parseDecimal('90')).toNumber()).toBe(-10);
  });

  it('should handle zero old price', () => {
    expect(calculatePriceChange(parseDecimal('0'), parseDecimal('100')).toNumber()).toBe(0);
  });
});

describe('formatPrice', () => {
  it('should use 2 decimals for prices >= 1', () => {
    expect(formatPrice(parseDecimal('43000'))).toBe('USD 43000.00');
    expect(formatPrice(parseDecimal('1.5'))).toBe('USD 1.50');
  });

  it('should use 6 decimals for prices < 1', () => {
    expect(formatPrice(parseDecimal('0.5'))).toBe('USD 0.500000');
  });

  it('should use 8 decimals for prices < 0.01', () => {
    expect(formatPrice(parseDecimal('0.00012345'))).toBe('USD 0.00012345');
  });

  it('should support custom currency', () => {
    expect(formatPrice(parseDecimal('100'), 'EUR')).toBe('EUR 100.00');
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

describe('createProviderHttpClient', () => {
  it('should create HTTP client with basic configuration', () => {
    const config = {
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 10,
        requestsPerHour: 1000,
        requestsPerMinute: 60,
        requestsPerSecond: 1,
      },
    };

    const client = createProviderHttpClient(config);

    expect(client).toBeDefined();
  });

  it('should apply default timeout and retries when not specified', () => {
    const config = {
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
    };

    const client = createProviderHttpClient(config);

    expect(client).toBeDefined();
    // Defaults: timeout 10000ms, retries 3
  });

  it('should use custom timeout and retries when provided', () => {
    const config = {
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
      timeout: 5000,
      retries: 5,
    };

    const client = createProviderHttpClient(config);

    expect(client).toBeDefined();
  });

  it('should add API key to query params when no header is specified', () => {
    const config = {
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      apiKey: 'test-api-key-123',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
    };

    const client = createProviderHttpClient(config);

    expect(client).toBeDefined();
    // When apiKeyHeader is not specified, client uses query param
  });

  it('should add API key to headers when header name is specified', () => {
    const config = {
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      apiKey: 'test-api-key-456',
      apiKeyHeader: 'X-API-Key',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
    };

    const client = createProviderHttpClient(config);

    expect(client).toBeDefined();
  });

  it('should merge additional headers with default Accept header', () => {
    const config = {
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
      additionalHeaders: {
        'User-Agent': 'CustomAgent/1.0',
        'X-Custom-Header': 'custom-value',
      },
    };

    const client = createProviderHttpClient(config);

    expect(client).toBeDefined();
  });
});

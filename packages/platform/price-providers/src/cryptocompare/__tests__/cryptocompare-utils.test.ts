/**
 * Tests for CryptoCompare utility functions
 *
 * Pure function tests - no mocks needed
 */

import { Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  buildHistoricalParams,
  buildPriceMultiParams,
  buildPriceParams,
  canUseCurrentPrice,
  findClosestDataPoint,
  getHistoricalGranularity,
  transformHistoricalResponse,
  transformPriceResponse,
} from '../cryptocompare-utils.js';
import type { CryptoCompareHistoricalResponse, CryptoCompareOHLCV } from '../schemas.js';

describe('transformPriceResponse', () => {
  it('transforms price response to PriceData', () => {
    const response = { USD: 30000, EUR: 27000 };
    const asset = Currency.create('BTC');
    const timestamp = new Date('2024-01-01T00:00:00Z');
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformPriceResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        asset,
        timestamp,
        price: 30000,
        currency,
        source: 'cryptocompare',
        fetchedAt,
        granularity: undefined,
      });
    }
  });

  it('returns error when currency not found in response', () => {
    const response = { EUR: 27000 };
    const asset = Currency.create('BTC');
    const timestamp = new Date('2024-01-01T00:00:00Z');
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformPriceResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('CryptoCompare price for BTC');
      expect(result.error.message).toContain('not found');
    }
  });

  it('returns error when price is zero', () => {
    const response = { USD: 0 };
    const asset = Currency.create('CFG');
    const timestamp = new Date('2024-01-01T00:00:00Z');
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformPriceResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('CryptoCompare price for CFG');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });

  it('returns error when price is negative', () => {
    const response = { USD: -100 };
    const asset = Currency.create('BTC');
    const timestamp = new Date('2024-01-01T00:00:00Z');
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformPriceResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('CryptoCompare price for BTC');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });
});

describe('findClosestDataPoint', () => {
  const sampleData: CryptoCompareOHLCV[] = [
    {
      time: 1000,
      high: 100,
      low: 90,
      open: 95,
      close: 98,
      volumefrom: 1,
      volumeto: 100,
      conversionType: 'direct',
      conversionSymbol: '',
    },
    {
      time: 2000,
      high: 110,
      low: 100,
      open: 105,
      close: 108,
      volumefrom: 1,
      volumeto: 100,
      conversionType: 'direct',
      conversionSymbol: '',
    },
    {
      time: 3000,
      high: 120,
      low: 110,
      open: 115,
      close: 118,
      volumefrom: 1,
      volumeto: 100,
      conversionType: 'direct',
      conversionSymbol: '',
    },
  ];

  it('finds exact match', () => {
    const result = findClosestDataPoint(sampleData, 2000);
    expect(result?.time).toBe(2000);
    expect(result?.close).toBe(108);
  });

  it('finds closest point before target timestamp', () => {
    const result = findClosestDataPoint(sampleData, 2500);
    expect(result?.time).toBe(2000);
    expect(result?.close).toBe(108);
  });

  it('returns undefined for empty data', () => {
    const result = findClosestDataPoint([], 2000);
    expect(result).toBeUndefined();
  });

  it('returns undefined when all points are after target timestamp', () => {
    const result = findClosestDataPoint(sampleData, 500);
    expect(result).toBeUndefined();
  });

  it('returns latest point when target is after all data', () => {
    const result = findClosestDataPoint(sampleData, 5000);
    expect(result?.time).toBe(3000);
    expect(result?.close).toBe(118);
  });

  it('finds first point when it is closest', () => {
    const result = findClosestDataPoint(sampleData, 1100);
    expect(result?.time).toBe(1000);
    expect(result?.close).toBe(98);
  });
});

describe('transformHistoricalResponse', () => {
  it('transforms historical response to PriceData', () => {
    const response: CryptoCompareHistoricalResponse = {
      Response: 'Success',
      Message: '',
      HasWarning: false,
      Type: 100,
      Data: {
        Aggregated: false,
        TimeFrom: 1000,
        TimeTo: 3000,
        Data: [
          {
            time: 1000,
            high: 100,
            low: 90,
            open: 95,
            close: 98,
            volumefrom: 1,
            volumeto: 100,
            conversionType: 'direct',
            conversionSymbol: '',
          },
          {
            time: 2000,
            high: 110,
            low: 100,
            open: 105,
            close: 108,
            volumefrom: 1,
            volumeto: 100,
            conversionType: 'direct',
            conversionSymbol: '',
          },
        ],
      },
    };

    const asset = Currency.create('BTC');
    const timestamp = new Date(2000 * 1000); // Unix timestamp 2000 (1970-01-01T00:33:20Z)
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformHistoricalResponse(response, asset, timestamp, currency, fetchedAt, 'minute');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        asset,
        timestamp: new Date(2000 * 1000 - 20 * 1000), // Rounded to minute (1970-01-01T00:33:00Z)
        price: 108, // close price at time 2000
        currency,
        source: 'cryptocompare',
        fetchedAt,
        granularity: 'minute',
      });
    }
  });

  it('returns error when API returns error response', () => {
    const response: CryptoCompareHistoricalResponse = {
      Response: 'Error',
      Message: 'Invalid symbol',
      HasWarning: false,
      Type: 1,
      Data: {
        Aggregated: false,
        TimeFrom: 0,
        TimeTo: 0,
        Data: [],
      },
    };

    const asset = Currency.create('BTC');
    const timestamp = new Date(2000 * 1000);
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformHistoricalResponse(response, asset, timestamp, currency, fetchedAt, 'minute');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('CryptoCompare API error: Invalid symbol');
    }
  });

  it('returns error when no data found for timestamp', () => {
    const response: CryptoCompareHistoricalResponse = {
      Response: 'Success',
      Message: '',
      HasWarning: false,
      Type: 100,
      Data: {
        Aggregated: false,
        TimeFrom: 1000,
        TimeTo: 1000,
        Data: [],
      },
    };

    const asset = Currency.create('BTC');
    const timestamp = new Date(2000 * 1000);
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformHistoricalResponse(response, asset, timestamp, currency, fetchedAt, 'day');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('CryptoCompare has no historical data for BTC');
    }
  });

  it('returns error when Data structure is missing', () => {
    const response: CryptoCompareHistoricalResponse = {
      Response: 'Success',
      Message: 'Pair not trading',
      HasWarning: false,
      Type: 100,
      Data: undefined,
    };

    const asset = Currency.create('CFG');
    const timestamp = new Date(2000 * 1000);
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformHistoricalResponse(response, asset, timestamp, currency, fetchedAt, 'hour');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('CryptoCompare has no historical data for CFG');
    }
  });

  it('returns error when close price is zero', () => {
    const response: CryptoCompareHistoricalResponse = {
      Response: 'Success',
      Message: '',
      HasWarning: false,
      Type: 100,
      Data: {
        Aggregated: false,
        TimeFrom: 1000,
        TimeTo: 2000,
        Data: [
          {
            time: 2000,
            high: 0,
            low: 0,
            open: 0,
            close: 0,
            volumefrom: 0,
            volumeto: 0,
            conversionType: 'direct',
            conversionSymbol: '',
          },
        ],
      },
    };

    const asset = Currency.create('BTC');
    const timestamp = new Date(2000 * 1000);
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformHistoricalResponse(response, asset, timestamp, currency, fetchedAt, 'hour');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('price for BTC');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });

  it('returns error when close price is negative', () => {
    const response: CryptoCompareHistoricalResponse = {
      Response: 'Success',
      Message: '',
      HasWarning: false,
      Type: 100,
      Data: {
        Aggregated: false,
        TimeFrom: 1000,
        TimeTo: 2000,
        Data: [
          {
            time: 2000,
            high: 100,
            low: 90,
            open: 95,
            close: -10,
            volumefrom: 1,
            volumeto: 100,
            conversionType: 'direct',
            conversionSymbol: '',
          },
        ],
      },
    };

    const asset = Currency.create('BTC');
    const timestamp = new Date(2000 * 1000);
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T01:00:00Z');

    const result = transformHistoricalResponse(response, asset, timestamp, currency, fetchedAt, 'day');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('price for BTC');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });
});

describe('canUseCurrentPrice', () => {
  it('returns true for timestamps within 5 minutes', () => {
    const now = new Date();
    const recentTimestamp = new Date(now.getTime() - 4 * 60 * 1000); // 4 minutes ago

    expect(canUseCurrentPrice(recentTimestamp)).toBe(true);
  });

  it('returns false for timestamps older than 5 minutes', () => {
    const now = new Date();
    const oldTimestamp = new Date(now.getTime() - 6 * 60 * 1000); // 6 minutes ago

    expect(canUseCurrentPrice(oldTimestamp)).toBe(false);
  });

  it('returns true for current timestamp', () => {
    const now = new Date();
    expect(canUseCurrentPrice(now)).toBe(true);
  });
});

describe('getHistoricalGranularity', () => {
  it('returns "minute" for timestamps within 7 days', () => {
    const now = new Date();
    const recentTimestamp = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

    expect(getHistoricalGranularity(recentTimestamp)).toBe('minute');
  });

  it('returns "hour" for timestamps within 90 days', () => {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    expect(getHistoricalGranularity(timestamp)).toBe('hour');
  });

  it('returns "day" for timestamps older than 90 days', () => {
    const now = new Date();
    const oldTimestamp = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000); // 120 days ago

    expect(getHistoricalGranularity(oldTimestamp)).toBe('day');
  });

  it('returns "minute" for exactly 6 days ago', () => {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

    expect(getHistoricalGranularity(timestamp)).toBe('minute');
  });

  it('returns "hour" for exactly 89 days ago', () => {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);

    expect(getHistoricalGranularity(timestamp)).toBe('hour');
  });
});

describe('buildPriceParams', () => {
  it('builds params without API key', () => {
    const asset = Currency.create('BTC');
    const currency = Currency.create('USD');

    const params = buildPriceParams(asset, currency);

    expect(params).toEqual({
      fsym: 'BTC',
      tsyms: 'USD',
    });
  });

  it('builds params with API key', () => {
    const asset = Currency.create('BTC');
    const currency = Currency.create('USD');
    const apiKey = 'test-api-key';

    const params = buildPriceParams(asset, currency, apiKey);

    expect(params).toEqual({
      fsym: 'BTC',
      tsyms: 'USD',
      api_key: 'test-api-key',
    });
  });
});

describe('buildPriceMultiParams', () => {
  it('builds params for multiple assets without API key', () => {
    const assets = [Currency.create('BTC'), Currency.create('ETH'), Currency.create('SOL')];
    const currency = Currency.create('USD');

    const params = buildPriceMultiParams(assets, currency);

    expect(params).toEqual({
      fsyms: 'BTC,ETH,SOL',
      tsyms: 'USD',
    });
  });

  it('builds params for multiple assets with API key', () => {
    const assets = [Currency.create('BTC'), Currency.create('ETH')];
    const currency = Currency.create('USD');
    const apiKey = 'test-api-key';

    const params = buildPriceMultiParams(assets, currency, apiKey);

    expect(params).toEqual({
      fsyms: 'BTC,ETH',
      tsyms: 'USD',
      api_key: 'test-api-key',
    });
  });

  it('builds params for single asset', () => {
    const assets = [Currency.create('BTC')];
    const currency = Currency.create('EUR');

    const params = buildPriceMultiParams(assets, currency);

    expect(params).toEqual({
      fsyms: 'BTC',
      tsyms: 'EUR',
    });
  });
});

describe('buildHistoricalParams', () => {
  it('builds params without API key', () => {
    const asset = Currency.create('BTC');
    const currency = Currency.create('USD');
    const timestamp = new Date('2024-01-01T00:00:00Z');

    const params = buildHistoricalParams(asset, currency, timestamp);

    expect(params).toEqual({
      fsym: 'BTC',
      tsym: 'USD',
      toTs: '1704067200', // Unix timestamp for 2024-01-01
      limit: '1',
    });
  });

  it('builds params with API key', () => {
    const asset = Currency.create('ETH');
    const currency = Currency.create('EUR');
    const timestamp = new Date('2023-06-15T12:30:00Z');
    const apiKey = 'test-api-key';

    const params = buildHistoricalParams(asset, currency, timestamp, apiKey);

    expect(params).toEqual({
      fsym: 'ETH',
      tsym: 'EUR',
      toTs: '1686832200', // Unix timestamp for 2023-06-15 12:30:00
      limit: '1',
      api_key: 'test-api-key',
    });
  });

  it('correctly converts timestamp to Unix seconds', () => {
    const asset = Currency.create('BTC');
    const currency = Currency.create('USD');
    const timestamp = new Date(1234567890000); // 2009-02-13T23:31:30.000Z

    const params = buildHistoricalParams(asset, currency, timestamp);

    expect(params.toTs).toBe('1234567890');
  });
});

/**
 * Tests for Frankfurter utility functions
 *
 * Pure function tests - no mocks needed
 */

import { Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  formatFrankfurterDate,
  FRANKFURTER_SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  transformFrankfurterResponse,
} from '../frankfurter-utils.js';
import type { FrankfurterSingleDateResponse } from '../schemas.js';

describe('formatFrankfurterDate', () => {
  it('formats date to YYYY-MM-DD', () => {
    const date = new Date('2024-01-15T14:30:00Z');
    const result = formatFrankfurterDate(date);

    expect(result).toBe('2024-01-15');
  });

  it('pads single-digit month and day', () => {
    const date = new Date('2024-03-05T00:00:00Z');
    const result = formatFrankfurterDate(date);

    expect(result).toBe('2024-03-05');
  });

  it('handles December and 31st', () => {
    const date = new Date('2023-12-31T23:59:59Z');
    const result = formatFrankfurterDate(date);

    expect(result).toBe('2023-12-31');
  });

  it('handles January and 1st', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const result = formatFrankfurterDate(date);

    expect(result).toBe('2024-01-01');
  });
});

describe('isSupportedCurrency', () => {
  it('returns true for supported currencies', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('EUR')).toBe(true);
    expect(isSupportedCurrency('CAD')).toBe(true);
    expect(isSupportedCurrency('GBP')).toBe(true);
    expect(isSupportedCurrency('JPY')).toBe(true);
    expect(isSupportedCurrency('CHF')).toBe(true);
  });

  it('returns false for unsupported currencies', () => {
    expect(isSupportedCurrency('BTC')).toBe(false);
    expect(isSupportedCurrency('ETH')).toBe(false);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(isSupportedCurrency('USDC')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isSupportedCurrency('usd')).toBe(false);
    expect(isSupportedCurrency('eur')).toBe(false);
    expect(isSupportedCurrency('Usd')).toBe(false);
  });
});

describe('FRANKFURTER_SUPPORTED_CURRENCIES', () => {
  it('contains expected major currencies', () => {
    const currencies = [...FRANKFURTER_SUPPORTED_CURRENCIES];

    expect(currencies).toContain('USD');
    expect(currencies).toContain('EUR');
    expect(currencies).toContain('CAD');
    expect(currencies).toContain('GBP');
    expect(currencies).toContain('JPY');
    expect(currencies).toContain('CHF');
    expect(currencies).toContain('AUD');
    expect(currencies).toContain('CNY');
  });

  it('has at least 30 currencies', () => {
    expect(FRANKFURTER_SUPPORTED_CURRENCIES.length).toBeGreaterThanOrEqual(30);
  });

  it('contains only uppercase currency codes', () => {
    FRANKFURTER_SUPPORTED_CURRENCIES.forEach((currency) => {
      expect(currency).toBe(currency.toUpperCase());
      expect(currency.length).toBe(3);
    });
  });
});

describe('transformFrankfurterResponse', () => {
  const asset = Currency.create('EUR');
  const targetCurrency = Currency.create('USD');
  const timestamp = new Date('2024-01-15T00:00:00Z');
  const fetchedAt = new Date('2024-01-15T12:00:00Z');

  it('transforms valid Frankfurter response to PriceData', () => {
    const response: FrankfurterSingleDateResponse = {
      amount: 1.0,
      base: 'EUR',
      date: '2024-01-15',
      rates: {
        USD: 1.0856,
      },
    };

    const result = transformFrankfurterResponse(response, asset, targetCurrency, timestamp, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        asset,
        timestamp,
        price: 1.0856,
        currency: targetCurrency,
        source: 'frankfurter',
        fetchedAt,
        granularity: 'day',
      });
    }
  });

  it('transforms response with multiple rates (extracts target currency)', () => {
    const response: FrankfurterSingleDateResponse = {
      amount: 1.0,
      base: 'EUR',
      date: '2024-01-15',
      rates: {
        CAD: 1.4587,
        GBP: 0.8532,
        JPY: 156.42,
        USD: 1.0856,
      },
    };

    const result = transformFrankfurterResponse(response, asset, targetCurrency, timestamp, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.price).toBe(1.0856);
      expect(result.value.currency.toString()).toBe('USD');
    }
  });

  it('handles CAD to USD conversion', () => {
    const cadAsset = Currency.create('CAD');
    const response: FrankfurterSingleDateResponse = {
      amount: 1.0,
      base: 'CAD',
      date: '2024-01-15',
      rates: {
        USD: 0.7456,
      },
    };

    const result = transformFrankfurterResponse(response, cadAsset, targetCurrency, timestamp, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.asset.toString()).toBe('CAD');
      expect(result.value.price).toBe(0.7456);
    }
  });

  it('handles GBP to USD conversion', () => {
    const gbpAsset = Currency.create('GBP');
    const response: FrankfurterSingleDateResponse = {
      amount: 1.0,
      base: 'GBP',
      date: '2024-01-15',
      rates: {
        USD: 1.2734,
      },
    };

    const result = transformFrankfurterResponse(response, gbpAsset, targetCurrency, timestamp, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.asset.toString()).toBe('GBP');
      expect(result.value.price).toBe(1.2734);
    }
  });

  it('returns error when no rates in response', () => {
    const response: FrankfurterSingleDateResponse = {
      amount: 1.0,
      base: 'EUR',
      date: '2024-01-15',
      rates: {},
    };

    const result = transformFrankfurterResponse(response, asset, targetCurrency, timestamp, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No exchange rate data found');
    }
  });

  it('returns error when target currency not in rates', () => {
    const response: FrankfurterSingleDateResponse = {
      amount: 1.0,
      base: 'EUR',
      date: '2024-01-15',
      rates: {
        CAD: 1.4587,
        GBP: 0.8532,
      },
    };

    const result = transformFrankfurterResponse(response, asset, targetCurrency, timestamp, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No rate found for USD');
    }
  });

  it('returns error for zero rate', () => {
    const response: FrankfurterSingleDateResponse = {
      amount: 1.0,
      base: 'EUR',
      date: '2024-01-15',
      rates: {
        USD: 0,
      },
    };

    const result = transformFrankfurterResponse(response, asset, targetCurrency, timestamp, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid exchange rate');
    }
  });

  it('returns error for negative rate', () => {
    const response: FrankfurterSingleDateResponse = {
      amount: 1.0,
      base: 'EUR',
      date: '2024-01-15',
      rates: {
        USD: -1.0856,
      },
    };

    const result = transformFrankfurterResponse(response, asset, targetCurrency, timestamp, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid exchange rate');
    }
  });
});

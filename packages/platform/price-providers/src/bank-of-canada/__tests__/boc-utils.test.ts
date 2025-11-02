/**
 * Tests for Bank of Canada utility functions
 *
 * Pure function tests - no mocks needed
 */

import { Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { formatBoCDate, transformBoCResponse } from '../boc-utils.js';
import type { BankOfCanadaResponse } from '../schemas.js';

describe('formatBoCDate', () => {
  it('formats date to YYYY-MM-DD', () => {
    const date = new Date('2024-01-15T14:30:00Z');
    const result = formatBoCDate(date);

    expect(result).toBe('2024-01-15');
  });

  it('pads single-digit month and day', () => {
    const date = new Date('2024-03-05T00:00:00Z');
    const result = formatBoCDate(date);

    expect(result).toBe('2024-03-05');
  });

  it('handles December and 31st', () => {
    const date = new Date('2023-12-31T23:59:59Z');
    const result = formatBoCDate(date);

    expect(result).toBe('2023-12-31');
  });

  it('handles January and 1st', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const result = formatBoCDate(date);

    expect(result).toBe('2024-01-01');
  });
});

describe('transformBoCResponse', () => {
  const asset = Currency.create('CAD');
  const timestamp = new Date('2024-01-15T00:00:00Z');
  const currency = Currency.create('USD');
  const fetchedAt = new Date('2024-01-15T12:00:00Z');

  it('transforms valid Bank of Canada response to PriceData', () => {
    const response: BankOfCanadaResponse = {
      observations: [
        {
          d: '2024-01-15',
          FXUSDCAD: {
            v: '1.3500', // USD/CAD rate
          },
        },
      ],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // CAD/USD = 1 / 1.3500 = 0.7407407407407407
      expect(result.value).toEqual({
        asset,
        timestamp,
        price: 1 / 1.35,
        currency,
        source: 'bank-of-canada',
        fetchedAt,
        granularity: 'day',
      });
      expect(result.value.price).toBeCloseTo(0.7407, 4);
    }
  });

  it('returns error when observations is empty', () => {
    const response: BankOfCanadaResponse = {
      observations: [],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No exchange rate data found for CAD on 2024-01-15');
    }
  });

  it('returns error for invalid rate string', () => {
    const response: BankOfCanadaResponse = {
      observations: [
        {
          d: '2024-01-15',
          FXUSDCAD: {
            v: 'invalid',
          },
        },
      ],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid exchange rate: invalid');
    }
  });

  it('returns error for zero exchange rate', () => {
    const response: BankOfCanadaResponse = {
      observations: [
        {
          d: '2024-01-15',
          FXUSDCAD: {
            v: '0',
          },
        },
      ],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid exchange rate: 0');
    }
  });

  it('returns error for negative exchange rate', () => {
    const response: BankOfCanadaResponse = {
      observations: [
        {
          d: '2024-01-15',
          FXUSDCAD: {
            v: '-1.35',
          },
        },
      ],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid exchange rate: -1.35');
    }
  });

  it('handles rates with many decimal places', () => {
    const response: BankOfCanadaResponse = {
      observations: [
        {
          d: '2024-01-15',
          FXUSDCAD: {
            v: '1.34567891',
          },
        },
      ],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // CAD/USD = 1 / 1.34567891
      expect(result.value.price).toBeCloseTo(0.7431, 4);
    }
  });

  it('correctly inverts USD/CAD to CAD/USD', () => {
    // If USD/CAD is 1.40 (1 USD = 1.40 CAD)
    // Then CAD/USD should be 1/1.40 = 0.7143 (1 CAD = 0.7143 USD)
    const response: BankOfCanadaResponse = {
      observations: [
        {
          d: '2024-01-15',
          FXUSDCAD: {
            v: '1.40',
          },
        },
      ],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.price).toBeCloseTo(0.7143, 4);
    }
  });

  it('handles typical CAD/USD exchange rate values', () => {
    const response: BankOfCanadaResponse = {
      observations: [
        {
          d: '2024-01-15',
          FXUSDCAD: {
            v: '1.3245', // Typical USD/CAD rate
          },
        },
      ],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.price).toBeCloseTo(0.755, 4);
      expect(result.value.price).toBeGreaterThan(0);
      expect(result.value.price).toBeLessThan(1); // CAD typically worth less than USD
    }
  });

  it('uses first observation when multiple are present', () => {
    const response: BankOfCanadaResponse = {
      observations: [
        {
          d: '2024-01-15',
          FXUSDCAD: {
            v: '1.3500',
          },
        },
        {
          d: '2024-01-16',
          FXUSDCAD: {
            v: '1.3600', // This should be ignored
          },
        },
      ],
    };

    const result = transformBoCResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should use 1.3500, not 1.3600
      expect(result.value.price).toBeCloseTo(0.7407, 4);
    }
  });
});

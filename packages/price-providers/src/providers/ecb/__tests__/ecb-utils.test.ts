/**
 * Tests for ECB utility functions
 *
 * Pure function tests - no mocks needed
 */

import { Currency, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { buildECBFlowRef, formatECBDate, transformECBResponse } from '../ecb-utils.js';
import type { ECBExchangeRateResponse } from '../schemas.js';

describe('formatECBDate', () => {
  it('formats date to YYYY-MM-DD', () => {
    const date = new Date('2024-01-15T14:30:00Z');
    const result = formatECBDate(date);

    expect(result).toBe('2024-01-15');
  });

  it('pads single-digit month and day', () => {
    const date = new Date('2024-03-05T00:00:00Z');
    const result = formatECBDate(date);

    expect(result).toBe('2024-03-05');
  });

  it('handles December and 31st', () => {
    const date = new Date('2023-12-31T23:59:59Z');
    const result = formatECBDate(date);

    expect(result).toBe('2023-12-31');
  });

  it('handles January and 1st', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const result = formatECBDate(date);

    expect(result).toBe('2024-01-01');
  });
});

describe('buildECBFlowRef', () => {
  it('builds flow reference for EUR/USD', () => {
    const result = buildECBFlowRef('EUR', 'USD');

    expect(result).toBe('D.EUR.USD.SP00.A');
  });

  it('builds flow reference for GBP/USD', () => {
    const result = buildECBFlowRef('GBP', 'USD');

    expect(result).toBe('D.GBP.USD.SP00.A');
  });

  it('builds flow reference for JPY/USD', () => {
    const result = buildECBFlowRef('JPY', 'USD');

    expect(result).toBe('D.JPY.USD.SP00.A');
  });
});

describe('transformECBResponse', () => {
  const asset = Currency.create('EUR');
  const timestamp = new Date('2024-01-15T00:00:00Z');
  const currency = Currency.create('USD');
  const fetchedAt = new Date('2024-01-15T12:00:00Z');

  it('transforms valid ECB response to PriceData', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {
            '0:0:0:0:0': {
              observations: {
                '0': [1.0856],
              },
            },
          },
        },
      ],
      structure: {
        dimensions: {
          observation: [
            {
              id: 'TIME_PERIOD',
              name: 'Time Period',
              values: [{ id: '2024-01-15', name: '2024-01-15' }],
            },
          ],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        assetSymbol: asset,
        timestamp,
        price: parseDecimal('1.0856'),
        currency,
        source: 'ecb',
        fetchedAt,
        granularity: 'day',
      });
    }
  });

  it('returns error when dataSets is empty', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No datasets in ECB response');
    }
  });

  it('returns error when dataset has no series', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {},
        },
      ],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No series found in ECB response');
    }
  });

  it('returns error when series has no observations', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {
            '0:0:0:0:0': {
              observations: {},
            },
          },
        },
      ],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No exchange rate data found for EUR on 2024-01-15');
    }
  });

  it('returns error for invalid observation format', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {
            '0:0:0:0:0': {
              observations: {
                '0': [] as unknown as [number], // Empty array
              },
            },
          },
        },
      ],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid exchange rate');
    }
  });

  it('returns error for zero exchange rate', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {
            '0:0:0:0:0': {
              observations: {
                '0': [0],
              },
            },
          },
        },
      ],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid exchange rate: 0');
    }
  });

  it('returns error for negative exchange rate', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {
            '0:0:0:0:0': {
              observations: {
                '0': [-1.5],
              },
            },
          },
        },
      ],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid exchange rate: -1.5');
    }
  });

  it('handles multiple series keys by using the first one', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {
            '0:0:0:0:0': {
              observations: {
                '0': [1.0856],
              },
            },
            '1:1:1:1:1': {
              observations: {
                '0': [1.1234], // This should be ignored
              },
            },
          },
        },
      ],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Should use the first series key
      expect(result.value.price.toNumber()).toBe(1.0856);
    }
  });

  it('handles very small exchange rates', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {
            '0:0:0:0:0': {
              observations: {
                '0': [0.000123],
              },
            },
          },
        },
      ],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.price.toNumber()).toBe(0.000123);
    }
  });

  it('handles large exchange rates', () => {
    const response: ECBExchangeRateResponse = {
      dataSets: [
        {
          series: {
            '0:0:0:0:0': {
              observations: {
                '0': [156.789], // JPY/USD
              },
            },
          },
        },
      ],
      structure: {
        dimensions: {
          observation: [],
        },
      },
    };

    const result = transformECBResponse(response, asset, timestamp, currency, fetchedAt);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.price.toNumber()).toBe(156.789);
    }
  });
});

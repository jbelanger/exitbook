import type { UniversalTransactionData } from '@exitbook/core';
import { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildViewMeta, getAllMovements, parseDate } from './view-utils.js';

describe('parseDate', () => {
  it('should parse valid ISO date string', () => {
    const result = parseDate('2024-01-01');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(0); // January
    expect(result.getUTCDate()).toBe(1);
  });

  it('should parse ISO date with time', () => {
    const result = parseDate('2024-01-01T12:30:45Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCHours()).toBe(12);
    expect(result.getUTCMinutes()).toBe(30);
    expect(result.getUTCSeconds()).toBe(45);
  });

  it('should parse date with timezone offset', () => {
    const result = parseDate('2024-01-01T12:00:00-05:00');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-01-01T17:00:00.000Z');
  });

  it('should parse date with milliseconds', () => {
    const result = parseDate('2024-01-01T12:00:00.123Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.getMilliseconds()).toBe(123);
  });

  it('should throw error for invalid date string', () => {
    expect(() => parseDate('invalid-date')).toThrow('Invalid date format: invalid-date');
  });

  it('should throw error for empty string', () => {
    expect(() => parseDate('')).toThrow('Invalid date format: ');
  });

  it('should throw error for invalid month', () => {
    expect(() => parseDate('2024-13-01')).toThrow('Invalid date format: 2024-13-01');
  });

  it('should throw error for invalid day', () => {
    expect(() => parseDate('2024-01-32')).toThrow('Invalid date format: 2024-01-32');
  });

  it('should throw error for malformed string', () => {
    expect(() => parseDate('not a date')).toThrow('Invalid date format: not a date');
  });

  it('should parse leap year date', () => {
    const result = parseDate('2024-02-29');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCMonth()).toBe(1); // February
    expect(result.getUTCDate()).toBe(29);
  });

  it('should auto-correct invalid dates like non-leap year Feb 29', () => {
    // JavaScript Date constructor auto-corrects invalid dates
    // 2023-02-29 becomes 2023-03-01
    const result = parseDate('2023-02-29');
    expect(result.getUTCMonth()).toBe(2); // March
    expect(result.getUTCDate()).toBe(1);
  });

  it('should parse dates far in the past', () => {
    const result = parseDate('1900-01-01');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(1900);
  });

  it('should parse dates far in the future', () => {
    const result = parseDate('2100-12-31');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(2100);
  });

  it('should handle short date format', () => {
    const result = parseDate('2024-1-1');
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(0);
    expect(result.getUTCDate()).toBe(1);
  });
});

describe('buildViewMeta', () => {
  it('should build meta with hasMore false when all results shown', () => {
    const meta = buildViewMeta(10, 0, 20, 10);

    expect(meta.count).toBe(10);
    expect(meta.offset).toBe(0);
    expect(meta.limit).toBe(20);
    expect(meta.hasMore).toBe(false);
    expect(meta.filters).toBeUndefined();
  });

  it('should build meta with hasMore true when more results available', () => {
    const meta = buildViewMeta(20, 0, 20, 50);

    expect(meta.count).toBe(20);
    expect(meta.offset).toBe(0);
    expect(meta.limit).toBe(20);
    expect(meta.hasMore).toBe(true);
  });

  it('should build meta with hasMore false on last page', () => {
    const meta = buildViewMeta(10, 40, 20, 50);

    expect(meta.count).toBe(10);
    expect(meta.offset).toBe(40);
    expect(meta.limit).toBe(20);
    expect(meta.hasMore).toBe(false); // 40 + 10 = 50 (all shown)
  });

  it('should build meta with hasMore true for middle page', () => {
    const meta = buildViewMeta(20, 20, 20, 100);

    expect(meta.count).toBe(20);
    expect(meta.offset).toBe(20);
    expect(meta.limit).toBe(20);
    expect(meta.hasMore).toBe(true); // 20 + 20 = 40 < 100
  });

  it('should include filters when provided', () => {
    const filters = { asset: 'BTC', source: 'kraken' };
    const meta = buildViewMeta(10, 0, 20, 10, filters);

    expect(meta.filters).toEqual(filters);
  });

  it('should handle empty filters object', () => {
    const meta = buildViewMeta(10, 0, 20, 10, {});

    expect(meta.filters).toEqual({});
  });

  it('should handle undefined filters', () => {
    const meta = buildViewMeta(10, 0, 20, 10);

    expect(meta.filters).toBeUndefined();
  });

  it('should handle zero count', () => {
    const meta = buildViewMeta(0, 0, 20, 0);

    expect(meta.count).toBe(0);
    expect(meta.hasMore).toBe(false);
  });

  it('should handle zero total count', () => {
    const meta = buildViewMeta(0, 0, 20, 0);

    expect(meta.count).toBe(0);
    expect(meta.hasMore).toBe(false);
  });

  it('should handle large offset', () => {
    const meta = buildViewMeta(5, 1000, 20, 1005);

    expect(meta.offset).toBe(1000);
    expect(meta.count).toBe(5);
    expect(meta.hasMore).toBe(false);
  });

  it('should handle limit of 1', () => {
    const meta = buildViewMeta(1, 0, 1, 100);

    expect(meta.limit).toBe(1);
    expect(meta.hasMore).toBe(true);
  });

  it('should handle exact boundary condition', () => {
    const meta = buildViewMeta(20, 0, 20, 20);

    expect(meta.hasMore).toBe(false); // 0 + 20 = 20 (exact match)
  });

  it('should handle boundary condition with one more item', () => {
    const meta = buildViewMeta(20, 0, 20, 21);

    expect(meta.hasMore).toBe(true); // 0 + 20 = 20 < 21
  });

  it('should handle complex filters object', () => {
    const filters = {
      asset: 'BTC',
      source: 'kraken',
      since: '2024-01-01',
      until: '2024-12-31',
      limit: 100,
    };
    const meta = buildViewMeta(50, 0, 100, 500, filters);

    expect(meta.filters).toEqual(filters);
  });
});

describe('getAllMovements', () => {
  it('should return empty array when no movements', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: [],
      outflows: [],
    };

    const result = getAllMovements(movements);

    expect(result).toEqual([]);
  });

  it('should return only inflows when no outflows', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          grossAmount: new Decimal('1'),
        },
      ],
      outflows: [],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.grossAmount.toFixed()).toBe('1');
  });

  it('should return only outflows when no inflows', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: [],
      outflows: [
        {
          asset: 'BTC',
          grossAmount: new Decimal('1'),
        },
      ],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.grossAmount.toFixed()).toBe('1');
  });

  it('should combine inflows and outflows', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          grossAmount: new Decimal('1'),
        },
      ],
      outflows: [
        {
          asset: 'BTC',
          grossAmount: new Decimal('0.5'),
        },
      ],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(2);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.grossAmount.toFixed()).toBe('1');
    expect(result[1]!.asset).toBe('BTC');
    expect(result[1]!.grossAmount.toFixed()).toBe('0.5');
  });

  it('should handle multiple inflows and outflows', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          grossAmount: new Decimal('1'),
        },
        {
          asset: 'ETH',
          grossAmount: new Decimal('10'),
        },
      ],
      outflows: [
        {
          asset: 'USD',
          grossAmount: new Decimal('80000'),
        },
        {
          asset: 'BTC',
          grossAmount: new Decimal('0.1'),
        },
      ],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(4);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[1]!.asset).toBe('ETH');
    expect(result[2]!.asset).toBe('USD');
    expect(result[3]!.asset).toBe('BTC');
  });

  it('should handle undefined inflows', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: undefined,
      outflows: [
        {
          asset: 'BTC',
          grossAmount: new Decimal('1'),
        },
      ],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
  });

  it('should handle undefined outflows', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          grossAmount: new Decimal('1'),
        },
      ],
      outflows: undefined,
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
  });

  it('should handle both inflows and outflows undefined', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: undefined,
      outflows: undefined,
    };

    const result = getAllMovements(movements);

    expect(result).toEqual([]);
  });

  it('should preserve movement properties', () => {
    const movements: UniversalTransactionData['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          grossAmount: new Decimal('1.23456789'),
          netAmount: new Decimal('1.23356789'),
          priceAtTxTime: {
            price: {
              amount: new Decimal('40500.5'),
              currency: Currency.create('USD'),
            },
            source: 'test-provider',
            fetchedAt: new Date('2024-01-01'),
          },
        },
      ],
      outflows: [],
    };

    const result = getAllMovements(movements);

    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.grossAmount.toFixed()).toBe('1.23456789');
    expect(result[0]!.netAmount?.toFixed()).toBe('1.23356789');
    expect(result[0]!.priceAtTxTime?.price.amount.toFixed()).toBe('40500.5');
  });

  it('should not modify original movements arrays', () => {
    const inflows = [
      {
        asset: 'BTC',
        grossAmount: new Decimal('1'),
      },
    ];
    const movements: UniversalTransactionData['movements'] = {
      inflows,
      outflows: [],
    };

    getAllMovements(movements);

    expect(movements.inflows).toBe(inflows); // Same reference
    expect(movements.inflows?.length).toBe(1);
  });
});

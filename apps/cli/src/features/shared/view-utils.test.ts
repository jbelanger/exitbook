/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- acceptable for tests */
import type { UniversalTransaction } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildViewMeta, getAllMovements, parseDate } from './view-utils.js';

describe('parseDate', () => {
  it('should parse valid ISO date string', () => {
    const result = parseDate('2024-01-01');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(1);
  });

  it('should parse ISO date with time', () => {
    const result = parseDate('2024-01-01T12:30:45Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(45);
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
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(29);
  });

  it('should auto-correct invalid dates like non-leap year Feb 29', () => {
    // JavaScript Date constructor auto-corrects invalid dates
    // 2023-02-29 becomes 2023-03-01
    const result = parseDate('2023-02-29');
    expect(result.getMonth()).toBe(2); // March
    expect(result.getDate()).toBe(1);
  });

  it('should parse dates far in the past', () => {
    const result = parseDate('1900-01-01');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(1900);
  });

  it('should parse dates far in the future', () => {
    const result = parseDate('2100-12-31');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2100);
  });

  it('should handle short date format', () => {
    const result = parseDate('2024-1-1');
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
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
    const movements: UniversalTransaction['movements'] = {
      inflows: [],
      outflows: [],
    };

    const result = getAllMovements(movements);

    expect(result).toEqual([]);
  });

  it('should return only inflows when no outflows', () => {
    const movements: UniversalTransaction['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          quantity: new Decimal('1'),
          quantityUsd: new Decimal('50000'),
          priceUsd: new Decimal('50000'),
          location: 'kraken',
        },
      ],
      outflows: [],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.quantity.toFixed()).toBe('1');
  });

  it('should return only outflows when no inflows', () => {
    const movements: UniversalTransaction['movements'] = {
      inflows: [],
      outflows: [
        {
          asset: 'BTC',
          quantity: new Decimal('1'),
          quantityUsd: new Decimal('50000'),
          priceUsd: new Decimal('50000'),
          location: 'kraken',
        },
      ],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.quantity.toFixed()).toBe('1');
  });

  it('should combine inflows and outflows', () => {
    const movements: UniversalTransaction['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          quantity: new Decimal('1'),
          quantityUsd: new Decimal('50000'),
          priceUsd: new Decimal('50000'),
          location: 'wallet',
        },
      ],
      outflows: [
        {
          asset: 'BTC',
          quantity: new Decimal('0.5'),
          quantityUsd: new Decimal('25000'),
          priceUsd: new Decimal('50000'),
          location: 'kraken',
        },
      ],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(2);
    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.quantity.toFixed()).toBe('1');
    expect(result[0]!.location).toBe('wallet');
    expect(result[1]!.asset).toBe('BTC');
    expect(result[1]!.quantity.toFixed()).toBe('0.5');
    expect(result[1]!.location).toBe('kraken');
  });

  it('should handle multiple inflows and outflows', () => {
    const movements: UniversalTransaction['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          quantity: new Decimal('1'),
          quantityUsd: new Decimal('50000'),
          priceUsd: new Decimal('50000'),
          location: 'wallet1',
        },
        {
          asset: 'ETH',
          quantity: new Decimal('10'),
          quantityUsd: new Decimal('30000'),
          priceUsd: new Decimal('3000'),
          location: 'wallet2',
        },
      ],
      outflows: [
        {
          asset: 'USD',
          quantity: new Decimal('80000'),
          quantityUsd: new Decimal('80000'),
          priceUsd: new Decimal('1'),
          location: 'bank',
        },
        {
          asset: 'BTC',
          quantity: new Decimal('0.1'),
          quantityUsd: new Decimal('5000'),
          priceUsd: new Decimal('50000'),
          location: 'fee',
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
    const movements: UniversalTransaction['movements'] = {
      inflows: undefined,
      outflows: [
        {
          asset: 'BTC',
          quantity: new Decimal('1'),
          quantityUsd: new Decimal('50000'),
          priceUsd: new Decimal('50000'),
          location: 'kraken',
        },
      ],
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
  });

  it('should handle undefined outflows', () => {
    const movements: UniversalTransaction['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          quantity: new Decimal('1'),
          quantityUsd: new Decimal('50000'),
          priceUsd: new Decimal('50000'),
          location: 'kraken',
        },
      ],
      outflows: undefined,
    };

    const result = getAllMovements(movements);

    expect(result).toHaveLength(1);
    expect(result[0]!.asset).toBe('BTC');
  });

  it('should handle both inflows and outflows undefined', () => {
    const movements: UniversalTransaction['movements'] = {
      inflows: undefined,
      outflows: undefined,
    };

    const result = getAllMovements(movements);

    expect(result).toEqual([]);
  });

  it('should preserve movement properties', () => {
    const movements: UniversalTransaction['movements'] = {
      inflows: [
        {
          asset: 'BTC',
          quantity: new Decimal('1.23456789'),
          quantityUsd: new Decimal('50000.12345'),
          priceUsd: new Decimal('40500.5'),
          location: 'my-wallet',
          feeAmount: new Decimal('0.001'),
          tags: ['trade', 'important'],
        },
      ],
      outflows: [],
    };

    const result = getAllMovements(movements);

    expect(result[0]!.asset).toBe('BTC');
    expect(result[0]!.quantity.toFixed()).toBe('1.23456789');
    expect(result[0]!.quantityUsd?.toFixed()).toBe('50000.12345');
    expect(result[0]!.priceUsd?.toFixed()).toBe('40500.5');
    expect(result[0]!.location).toBe('my-wallet');
    expect(result[0]!.feeAmount?.toFixed()).toBe('0.001');
    expect(result[0]!.tags).toEqual(['trade', 'important']);
  });

  it('should not modify original movements arrays', () => {
    const inflows = [
      {
        asset: 'BTC',
        quantity: new Decimal('1'),
        quantityUsd: new Decimal('50000'),
        priceUsd: new Decimal('50000'),
        location: 'kraken',
      },
    ];
    const movements: UniversalTransaction['movements'] = {
      inflows,
      outflows: [],
    };

    getAllMovements(movements);

    expect(movements.inflows).toBe(inflows); // Same reference
    expect(movements.inflows?.length).toBe(1);
  });
});

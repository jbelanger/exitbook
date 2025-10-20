import { Currency, parseDecimal } from '@exitbook/core';
import type { TransactionNeedingPrice } from '@exitbook/data';
import { describe, expect, it } from 'vitest';

import { initializeStats, extractAssetsNeedingPrices, createPriceQuery, validateAssetFilter } from '../prices-utils.ts';

describe('validateAssetFilter', () => {
  it('should return empty array when asset is undefined', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- testing explicit undefined
    const result = validateAssetFilter(undefined);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([]);
    }
  });

  it('should accept single valid asset', () => {
    const result = validateAssetFilter('BTC');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value?.[0]?.toString()).toBe('BTC');
    }
  });

  it('should accept array of valid assets', () => {
    const result = validateAssetFilter(['BTC', 'ETH', 'SOL']);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(3);
      expect(result.value?.[0]?.toString()).toBe('BTC');
      expect(result.value?.[1]?.toString()).toBe('ETH');
      expect(result.value?.[2]?.toString()).toBe('SOL');
    }
  });

  it('should normalize asset to uppercase', () => {
    const result = validateAssetFilter('btc');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value?.[0]?.toString()).toBe('BTC');
    }
  });

  it('should accept assets with numbers', () => {
    const result = validateAssetFilter('1INCH');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value?.[0]?.toString()).toBe('1INCH');
    }
  });

  it('should treat empty string as no filter', () => {
    const result = validateAssetFilter('');

    // Empty string is falsy, so treated as undefined/no filter
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([]);
    }
  });

  it('should reject whitespace-only string', () => {
    const result = validateAssetFilter('   ');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid asset');
    }
  });

  it('should reject asset with special characters', () => {
    const result = validateAssetFilter('BTC-USD');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid asset format');
    }
  });

  it('should reject asset with spaces', () => {
    const result = validateAssetFilter('BTC ETH');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid asset format');
    }
  });

  it('should reject array containing invalid asset', () => {
    const result = validateAssetFilter(['BTC', 'ETH@', 'SOL']);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid asset format');
    }
  });

  it('should reject non-string values in array', () => {
    const result = validateAssetFilter(['BTC', '', 'SOL']);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid asset');
    }
  });
});

describe('extractAssetsNeedingPrices', () => {
  it('should extract unique assets from movements and filter out fiat currencies', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [{ asset: 'BTC', amount: parseDecimal('1') }],
      movementsOutflows: [{ asset: 'USD', amount: parseDecimal('50000') }],
    };

    const result = extractAssetsNeedingPrices(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value).toContain('BTC');
      expect(result.value).not.toContain('USD'); // USD is fiat and should be filtered out
    }
  });

  it('should return only assets without prices', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [
        {
          asset: 'BTC',
          amount: parseDecimal('1'),
          priceAtTxTime: {
            price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
            source: 'coingecko',
            fetchedAt: new Date(),
          },
        },
      ],
      movementsOutflows: [{ asset: 'ETH', amount: parseDecimal('10') }],
    };

    const result = extractAssetsNeedingPrices(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value).toContain('ETH');
      expect(result.value).not.toContain('BTC');
    }
  });

  it('should reject transaction with no movements', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [],
      movementsOutflows: [],
    };

    const result = extractAssetsNeedingPrices(tx);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('has no movements');
    }
  });

  it('should deduplicate assets across inflows and outflows', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [{ asset: 'BTC', amount: parseDecimal('1') }],
      movementsOutflows: [{ asset: 'BTC', amount: parseDecimal('0.5') }],
    };

    const result = extractAssetsNeedingPrices(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value).toContain('BTC');
    }
  });

  it('should filter out all common fiat currencies', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [
        { asset: 'BTC', amount: parseDecimal('1') },
        { asset: 'ETH', amount: parseDecimal('10') },
      ],
      movementsOutflows: [
        { asset: 'USD', amount: parseDecimal('50000') },
        { asset: 'EUR', amount: parseDecimal('45000') },
        { asset: 'CAD', amount: parseDecimal('65000') },
        { asset: 'GBP', amount: parseDecimal('40000') },
      ],
    };

    const result = extractAssetsNeedingPrices(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(2);
      expect(result.value).toContain('BTC');
      expect(result.value).toContain('ETH');
      expect(result.value).not.toContain('USD');
      expect(result.value).not.toContain('EUR');
      expect(result.value).not.toContain('CAD');
      expect(result.value).not.toContain('GBP');
    }
  });

  it('should return empty array when only fiat currencies need prices', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [{ asset: 'USD', amount: parseDecimal('1000') }],
      movementsOutflows: [{ asset: 'EUR', amount: parseDecimal('900') }],
    };

    const result = extractAssetsNeedingPrices(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(0);
    }
  });
});

describe('createPriceQuery', () => {
  it('should create price query for asset', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [],
      movementsOutflows: [],
    };

    const result = createPriceQuery(tx, 'BTC');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.asset.toString()).toBe('BTC');
      expect(result.value.currency.toString()).toBe('USD');
      expect(result.value.timestamp).toEqual(new Date('2024-01-15T12:00:00.000Z'));
    }
  });

  it('should use default USD currency', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [],
      movementsOutflows: [],
    };

    const result = createPriceQuery(tx, 'ETH');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.currency.toString()).toBe('USD');
    }
  });

  it('should accept custom target currency', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '2024-01-15T12:00:00.000Z',
      movementsInflows: [],
      movementsOutflows: [],
    };

    const result = createPriceQuery(tx, 'BTC', 'EUR');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.currency.toString()).toBe('EUR');
    }
  });

  it('should reject transaction without datetime', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: '',
      movementsInflows: [],
      movementsOutflows: [],
    };

    const result = createPriceQuery(tx, 'BTC');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('no transaction datetime');
    }
  });

  it('should reject transaction with invalid datetime', () => {
    const tx: TransactionNeedingPrice = {
      id: 1,
      transactionDatetime: 'invalid-date',
      movementsInflows: [],
      movementsOutflows: [],
    };

    const result = createPriceQuery(tx, 'BTC');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('invalid datetime');
    }
  });
});

describe('initializeStats', () => {
  it('should return stats object with all counters at zero', () => {
    const stats = initializeStats();

    expect(stats).toEqual({
      failures: 0,
      granularity: {
        day: 0,
        exact: 0,
        hour: 0,
        minute: 0,
      },
      manualEntries: 0,
      movementsUpdated: 0,
      pricesFetched: 0,
      skipped: 0,
      transactionsFound: 0,
    });
  });

  it('should return new object each time', () => {
    const stats1 = initializeStats();
    const stats2 = initializeStats();

    expect(stats1).not.toBe(stats2);
    expect(stats1).toEqual(stats2);
  });

  it('should return mutable stats object', () => {
    const stats = initializeStats();

    stats.transactionsFound = 10;
    stats.pricesFetched = 8;
    stats.failures = 2;
    stats.manualEntries = 1;

    expect(stats.transactionsFound).toBe(10);
    expect(stats.pricesFetched).toBe(8);
    expect(stats.failures).toBe(2);
    expect(stats.manualEntries).toBe(1);
  });

  it('should have all required fields', () => {
    const stats = initializeStats();

    expect(stats).toHaveProperty('transactionsFound');
    expect(stats).toHaveProperty('pricesFetched');
    expect(stats).toHaveProperty('movementsUpdated');
    expect(stats).toHaveProperty('failures');
    expect(stats).toHaveProperty('skipped');
    expect(stats).toHaveProperty('manualEntries');
    expect(stats).toHaveProperty('granularity');
  });
});

import type { TransactionNeedingPrice } from '@exitbook/data';
import { describe, expect, it } from 'vitest';

import { initializeStats, transactionToPriceQuery, validateAssetFilter } from '../prices-utils.ts';

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

describe('transactionToPriceQuery', () => {
  const validTransaction: TransactionNeedingPrice = {
    id: 1,
    movementsPrimaryAsset: 'BTC',
    movementsPrimaryCurrency: 'USD',
    transactionDatetime: '2024-01-15T12:00:00.000Z',
  };

  it('should convert valid transaction to price query', () => {
    const result = transactionToPriceQuery(validTransaction);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.asset.toString()).toBe('BTC');
      expect(result.value.currency.toString()).toBe('USD');
      expect(result.value.timestamp).toEqual(new Date('2024-01-15T12:00:00.000Z'));
    }
  });

  it('should use default USD currency', () => {
    const result = transactionToPriceQuery(validTransaction);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.currency.toString()).toBe('USD');
    }
  });

  it('should accept custom target currency', () => {
    const result = transactionToPriceQuery(validTransaction, 'EUR');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.currency.toString()).toBe('EUR');
    }
  });

  it('should reject transaction without primary asset', () => {
    const tx = {
      ...validTransaction,
      movementsPrimaryAsset: '',
    };

    const result = transactionToPriceQuery(tx as TransactionNeedingPrice);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('no primary asset');
    }
  });

  it('should reject transaction without datetime', () => {
    const tx = {
      ...validTransaction,
      transactionDatetime: '',
    };

    const result = transactionToPriceQuery(tx as TransactionNeedingPrice);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('no transaction datetime');
    }
  });

  it('should reject transaction with invalid datetime', () => {
    const tx: TransactionNeedingPrice = {
      ...validTransaction,
      transactionDatetime: 'invalid-date',
    };

    const result = transactionToPriceQuery(tx);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('invalid datetime');
    }
  });

  it('should handle ISO datetime strings', () => {
    const tx: TransactionNeedingPrice = {
      ...validTransaction,
      transactionDatetime: '2024-01-15T14:30:45.123Z',
    };

    const result = transactionToPriceQuery(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.timestamp.toISOString()).toBe('2024-01-15T14:30:45.123Z');
    }
  });

  it('should handle different date formats', () => {
    const tx: TransactionNeedingPrice = {
      ...validTransaction,
      transactionDatetime: '2024-01-15',
    };

    const result = transactionToPriceQuery(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.timestamp).toEqual(new Date('2024-01-15'));
    }
  });

  it('should normalize asset to uppercase via Currency', () => {
    const tx: TransactionNeedingPrice = {
      ...validTransaction,
      movementsPrimaryAsset: 'btc',
    };

    const result = transactionToPriceQuery(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.asset.toString()).toBe('BTC');
    }
  });

  it('should include transaction ID in error messages', () => {
    const tx = {
      id: 42,
      movementsPrimaryAsset: '',
      movementsPrimaryCurrency: 'USD',
      transactionDatetime: '2024-01-15T12:00:00.000Z',
    };

    const result = transactionToPriceQuery(tx as TransactionNeedingPrice);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Transaction 42');
    }
  });

  it('should handle numeric transaction IDs', () => {
    const tx: TransactionNeedingPrice = {
      id: 12345,
      movementsPrimaryAsset: 'ETH',
      movementsPrimaryCurrency: 'USD',
      transactionDatetime: '2024-01-15T12:00:00.000Z',
    };

    const result = transactionToPriceQuery(tx);

    expect(result.isOk()).toBe(true);
  });

  it('should handle various crypto assets', () => {
    const assets = ['BTC', 'ETH', 'SOL', 'USDT', 'MATIC', '1INCH'];

    for (const asset of assets) {
      const tx: TransactionNeedingPrice = {
        ...validTransaction,
        movementsPrimaryAsset: asset,
      };

      const result = transactionToPriceQuery(tx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.asset.toString()).toBe(asset.toUpperCase());
      }
    }
  });
});

describe('initializeStats', () => {
  it('should return stats object with all counters at zero', () => {
    const stats = initializeStats();

    expect(stats).toEqual({
      transactionsFound: 0,
      pricesFetched: 0,
      pricesUpdated: 0,
      failures: 0,
      skipped: 0,
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

    expect(stats.transactionsFound).toBe(10);
    expect(stats.pricesFetched).toBe(8);
    expect(stats.failures).toBe(2);
  });

  it('should have all required fields', () => {
    const stats = initializeStats();

    expect(stats).toHaveProperty('transactionsFound');
    expect(stats).toHaveProperty('pricesFetched');
    expect(stats).toHaveProperty('pricesUpdated');
    expect(stats).toHaveProperty('failures');
    expect(stats).toHaveProperty('skipped');
  });
});

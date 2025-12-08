import { Currency, parseDecimal, type UniversalTransactionData } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  initializeStats,
  extractAssetsNeedingPrices,
  createPriceQuery,
  validateAssetFilter,
  determineEnrichmentStages,
} from '../prices-utils.js';

describe('validateAssetFilter', () => {
  it('should return empty array when asset is undefined', () => {
    const result = validateAssetFilter(void 0);

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
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1') }],
        outflows: [{ asset: 'USD', grossAmount: parseDecimal('50000') }],
      },
      fees: [],
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
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [
          {
            asset: 'BTC',
            grossAmount: parseDecimal('1'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
              source: 'coingecko',
              fetchedAt: new Date(),
            },
          },
        ],
        outflows: [{ asset: 'ETH', grossAmount: parseDecimal('10') }],
      },
      fees: [],
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
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: [],
    };

    const result = extractAssetsNeedingPrices(tx);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('has no movements');
    }
  });

  it('should deduplicate assets across inflows and outflows', () => {
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [{ asset: 'BTC', grossAmount: parseDecimal('1') }],
        outflows: [{ asset: 'BTC', grossAmount: parseDecimal('0.5') }],
      },
      fees: [],
    };

    const result = extractAssetsNeedingPrices(tx);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value).toContain('BTC');
    }
  });

  it('should filter out all common fiat currencies', () => {
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [
          { asset: 'BTC', grossAmount: parseDecimal('1') },
          { asset: 'ETH', grossAmount: parseDecimal('10') },
        ],
        outflows: [
          { asset: 'USD', grossAmount: parseDecimal('50000') },
          { asset: 'EUR', grossAmount: parseDecimal('45000') },
          { asset: 'CAD', grossAmount: parseDecimal('65000') },
          { asset: 'GBP', grossAmount: parseDecimal('40000') },
        ],
      },
      fees: [],
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
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [{ asset: 'USD', grossAmount: parseDecimal('1000') }],
        outflows: [{ asset: 'EUR', grossAmount: parseDecimal('900') }],
      },
      fees: [],
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
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: [],
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
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: [],
    };

    const result = createPriceQuery(tx, 'ETH');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.currency.toString()).toBe('USD');
    }
  });

  it('should accept custom target currency', () => {
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '2024-01-15T12:00:00.000Z',
      timestamp: Date.parse('2024-01-15T12:00:00.000Z'),
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: [],
    };

    const result = createPriceQuery(tx, 'BTC', 'EUR');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.currency.toString()).toBe('EUR');
    }
  });

  it('should reject transaction without datetime', () => {
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: '',
      timestamp: 0,
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: [],
    };

    const result = createPriceQuery(tx, 'BTC');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('no transaction datetime');
    }
  });

  it('should reject transaction with invalid datetime', () => {
    const tx: UniversalTransactionData = {
      id: 1,
      accountId: 1,
      datetime: 'invalid-date',
      timestamp: 0,
      source: 'test',
      status: 'success',
      externalId: 'test-1',
      operation: { category: 'trade', type: 'buy' },
      movements: {
        inflows: [],
        outflows: [],
      },
      fees: [],
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

describe('determineEnrichmentStages', () => {
  describe('default behavior (no flags)', () => {
    it('should enable all stages when no flags are set', () => {
      const stages = determineEnrichmentStages({});

      expect(stages).toEqual({
        normalize: true,
        derive: true,
        fetch: true,
      });
    });

    it('should enable all stages when all flags are undefined', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: undefined,
        deriveOnly: undefined,
        fetchOnly: undefined,
      });

      expect(stages).toEqual({
        normalize: true,
        derive: true,
        fetch: true,
      });
    });

    it('should enable all stages when all flags are false', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: false,
        deriveOnly: false,
        fetchOnly: false,
      });

      expect(stages).toEqual({
        normalize: true,
        derive: true,
        fetch: true,
      });
    });
  });

  describe('single stage flags', () => {
    it('should only enable normalize stage when normalizeOnly is true', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: true,
      });

      expect(stages).toEqual({
        normalize: true,
        derive: false,
        fetch: false,
      });
    });

    it('should only enable derive stage when deriveOnly is true', () => {
      const stages = determineEnrichmentStages({
        deriveOnly: true,
      });

      expect(stages).toEqual({
        normalize: false,
        derive: true,
        fetch: false,
      });
    });

    it('should only enable fetch stage when fetchOnly is true', () => {
      const stages = determineEnrichmentStages({
        fetchOnly: true,
      });

      expect(stages).toEqual({
        normalize: false,
        derive: false,
        fetch: true,
      });
    });
  });

  describe('multiple stage flags (edge cases)', () => {
    it('should disable all stages when normalizeOnly and deriveOnly are both true', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: true,
        deriveOnly: true,
      });

      expect(stages).toEqual({
        normalize: false,
        derive: false,
        fetch: false,
      });
    });

    it('should disable all stages when normalizeOnly and fetchOnly are both true', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: true,
        fetchOnly: true,
      });

      expect(stages).toEqual({
        normalize: false,
        derive: false,
        fetch: false,
      });
    });

    it('should disable all stages when deriveOnly and fetchOnly are both true', () => {
      const stages = determineEnrichmentStages({
        deriveOnly: true,
        fetchOnly: true,
      });

      expect(stages).toEqual({
        normalize: false,
        derive: false,
        fetch: false,
      });
    });

    it('should disable all stages when all flags are true', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: true,
        deriveOnly: true,
        fetchOnly: true,
      });

      expect(stages).toEqual({
        normalize: false,
        derive: false,
        fetch: false,
      });
    });
  });

  describe('mixed true/false flags', () => {
    it('should enable normalize and derive when fetchOnly is explicitly false', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: false,
        deriveOnly: false,
        fetchOnly: false,
      });

      expect(stages).toEqual({
        normalize: true,
        derive: true,
        fetch: true,
      });
    });

    it('should only enable normalize when deriveOnly is false and fetchOnly is true', () => {
      const stages = determineEnrichmentStages({
        deriveOnly: false,
        fetchOnly: true,
      });

      expect(stages).toEqual({
        normalize: false,
        derive: false,
        fetch: true,
      });
    });

    it('should only enable derive when normalizeOnly is false and fetchOnly is true', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: false,
        fetchOnly: true,
      });

      expect(stages).toEqual({
        normalize: false,
        derive: false,
        fetch: true,
      });
    });

    it('should only enable fetch when normalizeOnly is true and deriveOnly is false', () => {
      const stages = determineEnrichmentStages({
        normalizeOnly: true,
        deriveOnly: false,
      });

      expect(stages).toEqual({
        normalize: true,
        derive: false,
        fetch: false,
      });
    });
  });
});

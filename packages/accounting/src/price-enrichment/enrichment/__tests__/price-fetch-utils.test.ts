import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildTransaction, createFee, createTransactionFromMovements } from '../../../__tests__/test-utils.js';
import { createAccountingExclusionPolicy } from '../../../cost-basis/standard/validation/accounting-exclusion-policy.js';
import {
  createPriceQuery,
  determineEnrichmentStages,
  extractAssetsNeedingPrices,
  extractPriceFetchCandidates,
  initializeStats,
  validateAssetFilter,
} from '../price-fetch-utils.js';

describe('validateAssetFilter', () => {
  it('should return empty array for undefined input', () => {
    const result = assertOk(validateAssetFilter(undefined));
    expect(result).toEqual([]);
  });

  it('should parse a single asset string', () => {
    const result = assertOk(validateAssetFilter('BTC'));
    expect(result).toEqual(['BTC']);
  });

  it('should parse an array of assets', () => {
    const result = assertOk(validateAssetFilter(['BTC', 'ETH']));
    expect(result).toEqual(['BTC', 'ETH']);
  });

  it('should return empty array for empty string (falsy)', () => {
    const result = assertOk(validateAssetFilter(''));
    expect(result).toEqual([]);
  });

  it('should reject whitespace-only string', () => {
    const result = assertErr(validateAssetFilter('   '));
    expect(result.message).toContain('Invalid asset');
  });

  it('should reject special characters', () => {
    const result = assertErr(validateAssetFilter('BTC!'));
    expect(result.message).toContain('Invalid asset format');
  });

  it('should accept alphanumeric asset codes', () => {
    const result = assertOk(validateAssetFilter('USDT'));
    expect(result).toEqual(['USDT']);
  });

  it('should accept lowercase and normalize', () => {
    const result = assertOk(validateAssetFilter('btc'));
    expect(result).toEqual(['BTC']);
  });
});

describe('extractPriceFetchCandidates', () => {
  it('should return error for transaction with no movements', () => {
    const tx = createTransactionFromMovements(1, '2024-01-01T00:00:00Z');
    const result = assertErr(extractPriceFetchCandidates(tx));
    expect(result.message).toContain('no movements');
  });

  it('should extract unpriced crypto inflow', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
    });

    const candidates = assertOk(extractPriceFetchCandidates(tx));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.assetSymbol).toBe('BTC');
  });

  it('should skip fiat movements', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'USD', amount: '100', assetId: 'fiat:usd' }],
    });

    const candidates = assertOk(extractPriceFetchCandidates(tx));
    expect(candidates).toHaveLength(0);
  });

  it('should skip movements with non-tentative prices', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });

    const candidates = assertOk(extractPriceFetchCandidates(tx));
    expect(candidates).toHaveLength(0);
  });

  it('should include movements with tentative prices', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000', priceSource: 'fiat-execution-tentative' }],
    });

    const candidates = assertOk(extractPriceFetchCandidates(tx));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.assetSymbol).toBe('BTC');
  });

  it('should deduplicate by assetId across inflows and outflows', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
      outflows: [{ assetSymbol: 'BTC', amount: '0.5' }],
    });

    const candidates = assertOk(extractPriceFetchCandidates(tx));
    expect(candidates).toHaveLength(1);
  });

  it('should include unpriced fees', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
      fees: [createFee('ETH', '0.01')],
    });

    const candidates = assertOk(extractPriceFetchCandidates(tx));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.assetSymbol).toBe('ETH');
  });

  it('should skip excluded assets', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
    });

    const policy = createAccountingExclusionPolicy(['test:btc']);
    const candidates = assertOk(extractPriceFetchCandidates(tx, policy));
    expect(candidates).toHaveLength(0);
  });

  it('should extract candidates from both inflows and outflows', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
      outflows: [{ assetSymbol: 'ETH', amount: '10' }],
    });

    const candidates = assertOk(extractPriceFetchCandidates(tx));
    expect(candidates).toHaveLength(2);
    const symbols = candidates.map((c) => c.assetSymbol).sort();
    expect(symbols).toEqual(['BTC', 'ETH']);
  });
});

describe('extractAssetsNeedingPrices', () => {
  it('should return unique asset symbols', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
      outflows: [{ assetSymbol: 'ETH', amount: '10' }],
    });

    const symbols = assertOk(extractAssetsNeedingPrices(tx));
    expect(symbols.sort()).toEqual(['BTC', 'ETH']);
  });

  it('should propagate error from no movements', () => {
    const tx = createTransactionFromMovements(1, '2024-01-01T00:00:00Z');
    const result = assertErr(extractAssetsNeedingPrices(tx));
    expect(result.message).toContain('no movements');
  });
});

describe('createPriceQuery', () => {
  it('should create a valid price query', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-06-15T14:30:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
    });

    const query = assertOk(createPriceQuery(tx, 'BTC'));
    expect(query.assetSymbol).toBe('BTC');
    expect(query.currency).toBe('USD');
    expect(query.timestamp).toEqual(new Date('2024-06-15T14:30:00Z'));
  });

  it('should use custom target currency', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-06-15T14:30:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
    });

    const query = assertOk(createPriceQuery(tx, 'BTC', 'CAD'));
    expect(query.currency).toBe('CAD');
  });

  it('should return error for transaction without datetime', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
    });
    (tx as { datetime: string | undefined }).datetime = undefined;

    const result = assertErr(createPriceQuery(tx, 'BTC'));
    expect(result.message).toContain('no transaction datetime');
  });

  it('should return error for invalid datetime', () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }],
    });
    (tx as { datetime: string }).datetime = 'not-a-date';

    const result = assertErr(createPriceQuery(tx, 'BTC'));
    expect(result.message).toContain('invalid datetime');
  });
});

describe('initializeStats', () => {
  it('should return all-zero stats', () => {
    const stats = initializeStats();
    expect(stats.transactionsFound).toBe(0);
    expect(stats.pricesFetched).toBe(0);
    expect(stats.movementsUpdated).toBe(0);
    expect(stats.failures).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(stats.manualEntries).toBe(0);
    expect(stats.granularity).toEqual({ day: 0, exact: 0, hour: 0, minute: 0 });
  });
});

describe('determineEnrichmentStages', () => {
  it('should enable all stages when no flags set', () => {
    const stages = determineEnrichmentStages({});
    expect(stages).toEqual({ normalize: true, derive: true, fetch: true });
  });

  it('should enable only normalization when normalizeOnly', () => {
    const stages = determineEnrichmentStages({ normalizeOnly: true });
    expect(stages).toEqual({ normalize: true, derive: false, fetch: false });
  });

  it('should enable only derivation when deriveOnly', () => {
    const stages = determineEnrichmentStages({ deriveOnly: true });
    expect(stages).toEqual({ normalize: false, derive: true, fetch: false });
  });

  it('should enable only fetch when fetchOnly', () => {
    const stages = determineEnrichmentStages({ fetchOnly: true });
    expect(stages).toEqual({ normalize: false, derive: false, fetch: true });
  });
});

/**
 * Tests for price normalization utility functions
 *
 * These tests verify the pure business logic for price normalization
 * according to the "Functional Core, Imperative Shell" pattern.
 *
 * Internal helpers (extractMovementsNeedingNormalization, validateFxRate,
 * createNormalizedPrice, movementNeedsNormalization) are tested through the
 * public APIs: normalizeTransactionMovements and normalizePriceToUSD.
 */

import type { Transaction, PriceAtTxTime } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { ok, err } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { materializeTestTransaction } from '../../../__tests__/test-utils.js';
import { normalizeTransactionMovements, normalizePriceToUSD } from '../price-normalization-utils.js';

function createPersistedTransaction(transaction: Parameters<typeof materializeTestTransaction>[0]): Transaction {
  return materializeTestTransaction(transaction);
}

describe('normalizeTransactionMovements', () => {
  const stubFetchFxRate = (rate: string, source = 'ecb') => {
    return async () =>
      ok({
        rate: parseDecimal(rate),
        source,
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
      });
  };

  it('normalizes EUR prices to USD', async () => {
    const tx = createPersistedTransaction({
      id: 1,
      accountId: 1,
      identityReference: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      platformKey: 'test-exchange',
      sourceType: 'exchange' as const,
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [
          {
            assetId: 'test:usd',
            assetSymbol: 'EUR' as Currency,
            grossAmount: parseDecimal('40000'),
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    });

    const result = await normalizeTransactionMovements(tx, async (price, date) =>
      normalizePriceToUSD(price, date, stubFetchFxRate('1.08'))
    );

    expect(result.movementsNormalized).toBe(1);
    expect(result.movementsSkipped).toBe(0);
    expect(result.cryptoPriceMovements).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.transaction).toBeDefined();

    const normalizedInflow = result.transaction!.movements.inflows![0]!;
    expect(normalizedInflow.priceAtTxTime?.price.currency.toString()).toBe('USD');
    expect(normalizedInflow.priceAtTxTime?.price.amount.toFixed()).toBe('43200'); // 40000 * 1.08
    expect(normalizedInflow.priceAtTxTime?.fxRateToUSD?.toString()).toBe('1.08');
    expect(normalizedInflow.priceAtTxTime?.fxSource).toBe('ecb');
  });

  it('skips USD prices (already normalized)', async () => {
    const tx = createPersistedTransaction({
      id: 1,
      accountId: 1,
      identityReference: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      platformKey: 'test-exchange',
      sourceType: 'exchange' as const,
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [
          {
            assetId: 'test:usd',
            assetSymbol: 'USD' as Currency,
            grossAmount: parseDecimal('50000'),
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    });

    const result = await normalizeTransactionMovements(tx, async (price, date) =>
      normalizePriceToUSD(price, date, stubFetchFxRate('1.0'))
    );

    expect(result.movementsNormalized).toBe(0);
    expect(result.movementsSkipped).toBe(1);
    expect(result.transaction).toBeUndefined(); // No changes needed
  });

  it('identifies crypto prices in price field (unexpected)', async () => {
    const tx = createPersistedTransaction({
      id: 1,
      accountId: 1,
      identityReference: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      platformKey: 'test-exchange',
      sourceType: 'exchange' as const,
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50'), currency: 'ETH' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('50'),
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'swap' },
    });

    const result = await normalizeTransactionMovements(tx, async (price, date) =>
      normalizePriceToUSD(price, date, stubFetchFxRate('1.0'))
    );

    expect(result.movementsNormalized).toBe(0);
    expect(result.cryptoPriceMovements).toHaveLength(1);
    expect(result.cryptoPriceMovements[0]?.assetSymbol).toBe('BTC');
  });

  it('normalizes multiple currencies', async () => {
    const tx = createPersistedTransaction({
      id: 1,
      accountId: 1,
      identityReference: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      platformKey: 'test-exchange',
      sourceType: 'exchange' as const,
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('10.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('2000'), currency: 'CAD' as Currency },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    });

    const result = await normalizeTransactionMovements(tx, async (price, date) =>
      normalizePriceToUSD(price, date, stubFetchFxRate('1.08'))
    );

    expect(result.movementsNormalized).toBe(2);
    expect(result.movementsSkipped).toBe(0);
  });

  it('skips movements without prices', async () => {
    const tx = createPersistedTransaction({
      id: 1,
      accountId: 1,
      identityReference: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      platformKey: 'test-exchange',
      sourceType: 'exchange' as const,
      status: 'success',
      movements: {
        inflows: [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.0'),
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'transfer' },
    });

    const result = await normalizeTransactionMovements(tx, async (price, date) =>
      normalizePriceToUSD(price, date, stubFetchFxRate('1.0'))
    );

    expect(result.movementsNormalized).toBe(0);
    expect(result.movementsSkipped).toBe(0);
    expect(result.cryptoPriceMovements).toHaveLength(0);
  });
});

describe('normalizePriceToUSD', () => {
  it('accepts valid FX rates and converts correctly', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.price.currency.toString()).toBe('USD');
      expect(result.value.price.amount.toFixed()).toBe('43200'); // 40000 * 1.08
      expect(result.value.quotedPrice?.amount.toFixed()).toBe('40000');
      expect(result.value.quotedPrice?.currency.toString()).toBe('EUR');
      expect(result.value.fxRateToUSD?.toString()).toBe('1.08');
      expect(result.value.fxSource).toBe('ecb');
      expect(result.value.source).toBe('exchange-execution');
    }
  });

  it('rejects negative FX rates', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('-1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid FX rate');
    }
  });

  it('rejects zero FX rate', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('0'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isErr()).toBe(true);
  });

  it('rejects suspiciously low FX rates', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('0.00000001'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isErr()).toBe(true);
  });

  it('rejects suspiciously high FX rates', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('10000'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isErr()).toBe(true);
  });

  it('accepts very low but valid rates (e.g., VND)', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('1000000'), currency: 'VND' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('0.00004'), source: 'provider', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.price.amount.toFixed()).toBe('40'); // 1,000,000 * 0.00004
    }
  });

  it('handles decimal precision correctly (CAD)', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('1234.56'), currency: 'CAD' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('0.74'), source: 'bank-of-canada', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.price.amount.toFixed()).toBe('913.5744'); // 1234.56 * 0.74
    }
  });

  it('upgrades fiat-execution-tentative to derived-ratio after normalization', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
      source: 'fiat-execution-tentative',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.source).toBe('derived-ratio');
    }
  });

  it('preserves non-tentative sources after normalization', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      ok({ rate: parseDecimal('1.08'), source: 'ecb', fetchedAt: new Date('2023-01-15T10:00:00Z') })
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.source).toBe('exchange-execution');
    }
  });

  it('propagates FX rate fetch errors', async () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: 'EUR' as Currency },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const result = await normalizePriceToUSD(original, new Date('2023-01-15T10:00:00Z'), async () =>
      err(new Error('FX provider unavailable'))
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('FX provider unavailable');
    }
  });
});

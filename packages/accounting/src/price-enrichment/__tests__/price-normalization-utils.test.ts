/**
 * Tests for price normalization utility functions
 *
 * These tests verify the pure business logic for price normalization
 * according to the "Functional Core, Imperative Shell" pattern
 */

import { Currency, parseDecimal } from '@exitbook/core';
import type { AssetMovement, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  classifyMovementPrice,
  createNormalizedPrice,
  extractMovementsNeedingNormalization,
  movementNeedsNormalization,
  validateFxRate,
} from '../price-normalization-utils.js';

describe('extractMovementsNeedingNormalization', () => {
  it('identifies EUR prices needing normalization', () => {
    const tx: UniversalTransaction = {
      id: 1,
      externalId: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      source: 'test-exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            asset: Currency.create('BTC'),
            grossAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [
          {
            asset: Currency.create('EUR'),
            grossAmount: parseDecimal('40000'),
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    };

    const result = extractMovementsNeedingNormalization(tx);

    expect(result.needsNormalization).toHaveLength(1);
    expect(result.needsNormalization[0]?.asset.toString()).toBe('BTC');
    expect(result.skipped).toHaveLength(0);
    expect(result.cryptoPrices).toHaveLength(0);
  });

  it('skips USD prices (already normalized)', () => {
    const tx: UniversalTransaction = {
      id: 1,
      externalId: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      source: 'test-exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            asset: Currency.create('BTC'),
            grossAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [
          {
            asset: Currency.create('USD'),
            grossAmount: parseDecimal('50000'),
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'buy' },
    };

    const result = extractMovementsNeedingNormalization(tx);

    expect(result.needsNormalization).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.asset.toString()).toBe('BTC');
    expect(result.cryptoPrices).toHaveLength(0);
  });

  it('identifies crypto prices in price field (unexpected)', () => {
    const tx: UniversalTransaction = {
      id: 1,
      externalId: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      source: 'test-exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            asset: Currency.create('BTC'),
            grossAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('50'), currency: Currency.create('ETH') },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
        ],
        outflows: [
          {
            asset: Currency.create('ETH'),
            grossAmount: parseDecimal('50'),
          },
        ],
      },
      fees: [],
      operation: { category: 'trade', type: 'swap' },
    };

    const result = extractMovementsNeedingNormalization(tx);

    expect(result.needsNormalization).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.cryptoPrices).toHaveLength(1);
    expect(result.cryptoPrices[0]?.asset.toString()).toBe('BTC');
  });

  it('identifies multiple currencies needing normalization', () => {
    const tx: UniversalTransaction = {
      id: 1,
      externalId: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      source: 'test-exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            asset: Currency.create('BTC'),
            grossAmount: parseDecimal('1.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
              source: 'exchange-execution',
              fetchedAt: new Date('2023-01-15T10:00:00Z'),
              granularity: 'exact',
            },
          },
          {
            asset: Currency.create('ETH'),
            grossAmount: parseDecimal('10.0'),
            priceAtTxTime: {
              price: { amount: parseDecimal('2000'), currency: Currency.create('CAD') },
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
    };

    const result = extractMovementsNeedingNormalization(tx);

    expect(result.needsNormalization).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it('handles movements without prices', () => {
    const tx: UniversalTransaction = {
      id: 1,
      externalId: 'test-1',
      datetime: '2023-01-15T10:00:00Z',
      timestamp: Date.parse('2023-01-15T10:00:00Z'),
      source: 'test-exchange',
      status: 'success',
      movements: {
        inflows: [
          {
            asset: Currency.create('BTC'),
            grossAmount: parseDecimal('1.0'),
            // No priceAtTxTime
          },
        ],
        outflows: [],
      },
      fees: [],
      operation: { category: 'transfer', type: 'transfer' },
    };

    const result = extractMovementsNeedingNormalization(tx);

    expect(result.needsNormalization).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.cryptoPrices).toHaveLength(0);
  });
});

describe('validateFxRate', () => {
  it('accepts valid FX rates', () => {
    const validRates = [
      new Decimal('1.08'), // EUR→USD
      new Decimal('0.74'), // CAD→USD
      new Decimal('1.25'), // GBP→USD
      new Decimal('0.01'), // Low but reasonable
      new Decimal('100'), // High but reasonable
      new Decimal('0.00004'), // VND→USD (Vietnamese Dong)
      new Decimal('0.000064'), // IDR→USD (Indonesian Rupiah)
      new Decimal('0.00014'), // PYG→USD (Paraguayan Guaraní)
    ];

    for (const rate of validRates) {
      const result = validateFxRate(rate);
      expect(result.isOk()).toBe(true);
    }
  });

  it('rejects negative FX rates', () => {
    const result = validateFxRate(new Decimal('-1.08'));
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('must be positive');
  });

  it('rejects zero FX rate', () => {
    const result = validateFxRate(new Decimal('0'));
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('must be positive');
  });

  it('rejects suspiciously low FX rates', () => {
    const result = validateFxRate(new Decimal('0.00000001'));
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('too low');
  });

  it('rejects suspiciously high FX rates', () => {
    const result = validateFxRate(new Decimal('10000'));
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain('too high');
  });
});

describe('createNormalizedPrice', () => {
  it('creates normalized price with FX metadata', () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const fxRate = new Decimal('1.08');
    const fxSource = 'ecb';
    const fxTimestamp = new Date('2023-01-15T10:00:00Z');

    const result = createNormalizedPrice(original, fxRate, fxSource, fxTimestamp);

    // Verify price converted to USD
    expect(result.price.currency.toString()).toBe('USD');
    expect(result.price.amount.toFixed()).toBe('43200'); // 40000 * 1.08

    // Verify FX metadata populated
    expect(result.fxRateToUSD?.toString()).toBe('1.08');
    expect(result.fxSource).toBe('ecb');
    expect(result.fxTimestamp).toEqual(fxTimestamp);

    // Verify original metadata preserved
    expect(result.source).toBe('exchange-execution');
    expect(result.granularity).toBe('exact');
  });

  it('handles decimal precision correctly', () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('1234.56'), currency: Currency.create('CAD') },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const fxRate = new Decimal('0.74');
    const fxSource = 'bank-of-canada';
    const fxTimestamp = new Date('2023-01-15T10:00:00Z');

    const result = createNormalizedPrice(original, fxRate, fxSource, fxTimestamp);

    // 1234.56 * 0.74 = 913.5744
    expect(result.price.amount.toFixed()).toBe('913.5744');
  });

  it('upgrades fiat-execution-tentative to derived-ratio after normalization', () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
      source: 'fiat-execution-tentative', // Tentative source from non-USD fiat trade
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const fxRate = new Decimal('1.08');
    const fxSource = 'ecb';
    const fxTimestamp = new Date('2023-01-15T10:00:00Z');

    const result = createNormalizedPrice(original, fxRate, fxSource, fxTimestamp);

    // Should upgrade source from tentative to derived-ratio
    expect(result.source).toBe('derived-ratio');
    expect(result.fxRateToUSD?.toString()).toBe('1.08');
    expect(result.fxSource).toBe('ecb');
  });

  it('preserves non-tentative sources after normalization', () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
      source: 'exchange-execution', // Non-tentative source
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const fxRate = new Decimal('1.08');
    const fxSource = 'ecb';
    const fxTimestamp = new Date('2023-01-15T10:00:00Z');

    const result = createNormalizedPrice(original, fxRate, fxSource, fxTimestamp);

    // Should keep original source
    expect(result.source).toBe('exchange-execution');
    expect(result.fxRateToUSD?.toString()).toBe('1.08');
  });

  it('handles edge case: very low VND rate', () => {
    const original: PriceAtTxTime = {
      price: { amount: parseDecimal('1000000'), currency: Currency.create('VND') },
      source: 'exchange-execution',
      fetchedAt: new Date('2023-01-15T10:00:00Z'),
      granularity: 'exact',
    };

    const fxRate = new Decimal('0.00004'); // VND → USD
    const fxSource = 'provider';
    const fxTimestamp = new Date('2023-01-15T10:00:00Z');

    const result = createNormalizedPrice(original, fxRate, fxSource, fxTimestamp);

    // 1,000,000 VND * 0.00004 = 40 USD
    expect(result.price.amount.toFixed()).toBe('40');
    expect(result.price.currency.toString()).toBe('USD');
  });
});

describe('movementNeedsNormalization', () => {
  it('returns true for EUR prices', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
      priceAtTxTime: {
        price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
        source: 'exchange-execution',
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
        granularity: 'exact',
      },
    };

    expect(movementNeedsNormalization(movement)).toBe(true);
  });

  it('returns false for USD prices', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
      priceAtTxTime: {
        price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
        source: 'exchange-execution',
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
        granularity: 'exact',
      },
    };

    expect(movementNeedsNormalization(movement)).toBe(false);
  });

  it('returns false for movements without prices', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
    };

    expect(movementNeedsNormalization(movement)).toBe(false);
  });

  it('returns false for crypto prices (ETH)', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
      priceAtTxTime: {
        price: { amount: parseDecimal('50'), currency: Currency.create('ETH') },
        source: 'exchange-execution',
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
        granularity: 'exact',
      },
    };

    expect(movementNeedsNormalization(movement)).toBe(false);
  });
});

describe('classifyMovementPrice', () => {
  it('classifies no-price movements', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
    };

    expect(classifyMovementPrice(movement)).toBe('no-price');
  });

  it('classifies already-USD movements', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
      priceAtTxTime: {
        price: { amount: parseDecimal('50000'), currency: Currency.create('USD') },
        source: 'exchange-execution',
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
        granularity: 'exact',
      },
    };

    expect(classifyMovementPrice(movement)).toBe('already-usd');
  });

  it('classifies needs-normalization movements (EUR)', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
      priceAtTxTime: {
        price: { amount: parseDecimal('40000'), currency: Currency.create('EUR') },
        source: 'exchange-execution',
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
        granularity: 'exact',
      },
    };

    expect(classifyMovementPrice(movement)).toBe('needs-normalization');
  });

  it('classifies crypto price movements', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
      priceAtTxTime: {
        price: { amount: parseDecimal('50'), currency: Currency.create('ETH') },
        source: 'exchange-execution',
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
        granularity: 'exact',
      },
    };

    expect(classifyMovementPrice(movement)).toBe('crypto');
  });

  it('classifies CAD as needs-normalization', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
      priceAtTxTime: {
        price: { amount: parseDecimal('60000'), currency: Currency.create('CAD') },
        source: 'exchange-execution',
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
        granularity: 'exact',
      },
    };

    expect(classifyMovementPrice(movement)).toBe('needs-normalization');
  });

  it('classifies GBP as needs-normalization', () => {
    const movement: AssetMovement = {
      asset: Currency.create('BTC'),
      grossAmount: parseDecimal('1.0'),
      priceAtTxTime: {
        price: { amount: parseDecimal('35000'), currency: Currency.create('GBP') },
        source: 'exchange-execution',
        fetchedAt: new Date('2023-01-15T10:00:00Z'),
        granularity: 'exact',
      },
    };

    expect(classifyMovementPrice(movement)).toBe('needs-normalization');
  });
});

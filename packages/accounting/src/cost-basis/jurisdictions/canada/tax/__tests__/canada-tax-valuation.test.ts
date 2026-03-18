import type { Currency, PriceAtTxTime } from '@exitbook/core';
import { ok, err, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import type { IFxRateProvider } from '../../../../../price-enrichment/shared/types.js';
import { buildCanadaTaxValuation, createFiatIdentityPrice, normalizeDecimal } from '../canada-tax-valuation.js';

function createFxProvider(rates: {
  fromUSD?: Record<string, string>;
  toUSD?: Record<string, string>;
}): IFxRateProvider {
  return {
    getRateToUSD: async (currency: Currency) => {
      const rate = rates.toUSD?.[currency];
      if (!rate) return err(new Error(`No toUSD rate for ${currency}`));
      return ok({ rate: parseDecimal(rate), source: 'test', fetchedAt: new Date() });
    },
    getRateFromUSD: async (currency: Currency) => {
      const rate = rates.fromUSD?.[currency];
      if (!rate) return err(new Error(`No fromUSD rate for ${currency}`));
      return ok({ rate: parseDecimal(rate), source: 'test', fetchedAt: new Date() });
    },
  };
}

function createPrice(
  amount: string,
  currency: string,
  quotedPrice?: { amount: string; currency: string }
): PriceAtTxTime {
  return {
    price: { amount: parseDecimal(amount), currency: currency as Currency },
    quotedPrice: quotedPrice
      ? { amount: parseDecimal(quotedPrice.amount), currency: quotedPrice.currency as Currency }
      : undefined,
    source: 'test',
    fetchedAt: new Date(),
    granularity: 'exact' as const,
  };
}

const timestamp = new Date('2024-06-15T12:00:00Z');
const quantity = parseDecimal('10');

describe('normalizeDecimal', () => {
  it('should return zero for values below threshold', () => {
    expect(normalizeDecimal(parseDecimal('1e-19')).toFixed()).toBe('0');
    expect(normalizeDecimal(parseDecimal('-1e-19')).toFixed()).toBe('0');
  });

  it('should preserve values above threshold', () => {
    expect(normalizeDecimal(parseDecimal('0.001')).toFixed()).toBe('0.001');
    expect(normalizeDecimal(parseDecimal('-5')).toFixed()).toBe('-5');
  });
});

describe('buildCanadaTaxValuation', () => {
  it('should handle CAD quoted price directly', async () => {
    const price = createPrice('50000', 'USD', { amount: '68000', currency: 'CAD' });
    const fxProvider = createFxProvider({});

    const result = assertOk(await buildCanadaTaxValuation(price, quantity, timestamp, fxProvider));

    expect(result.taxCurrency).toBe('CAD');
    expect(result.unitValueCad.toFixed()).toBe('68000');
    expect(result.totalValueCad.toFixed()).toBe('680000');
    expect(result.valuationSource).toBe('quoted-price');
    expect(result.fxRateToCad).toBeUndefined();
  });

  it('should handle CAD storage price when no quoted price', async () => {
    const price = createPrice('68000', 'CAD');
    const fxProvider = createFxProvider({});

    const result = assertOk(await buildCanadaTaxValuation(price, quantity, timestamp, fxProvider));

    expect(result.unitValueCad.toFixed()).toBe('68000');
    expect(result.totalValueCad.toFixed()).toBe('680000');
    expect(result.valuationSource).toBe('stored-price');
  });

  it('should convert USD to CAD via FX provider', async () => {
    const price = createPrice('50000', 'USD');
    const fxProvider = createFxProvider({ fromUSD: { CAD: '1.36' } });

    const result = assertOk(await buildCanadaTaxValuation(price, quantity, timestamp, fxProvider));

    expect(result.unitValueCad.toFixed()).toBe('68000');
    expect(result.totalValueCad.toFixed()).toBe('680000');
    expect(result.valuationSource).toBe('usd-to-cad-fx');
    expect(result.fxRateToCad!.toFixed()).toBe('1.36');
  });

  it('should convert other fiat currencies through USD to CAD', async () => {
    const price = createPrice('45000', 'EUR');
    const fxProvider = createFxProvider({
      toUSD: { EUR: '1.1' },
      fromUSD: { CAD: '1.36' },
    });

    const result = assertOk(await buildCanadaTaxValuation(price, quantity, timestamp, fxProvider));

    // 45000 EUR × 1.1 USD/EUR × 1.36 CAD/USD = 67320 CAD
    expect(result.unitValueCad.toFixed()).toBe('67320');
    expect(result.valuationSource).toBe('fiat-to-cad-fx');
  });

  it('should return error for non-fiat price currency', async () => {
    const price = createPrice('1', 'BTC');
    const fxProvider = createFxProvider({});

    const result = assertErr(await buildCanadaTaxValuation(price, quantity, timestamp, fxProvider));

    expect(result.message).toContain('requires fiat or USD price data');
    expect(result.message).toContain('BTC');
  });

  it('should return error when USD→CAD FX rate fails', async () => {
    const price = createPrice('50000', 'USD');
    const fxProvider = createFxProvider({}); // No rates configured

    const result = assertErr(await buildCanadaTaxValuation(price, quantity, timestamp, fxProvider));

    expect(result.message).toContain('Failed to convert USD price to CAD');
  });

  it('should return error when toUSD conversion fails for other fiat', async () => {
    const price = createPrice('45000', 'EUR');
    const fxProvider = createFxProvider({ fromUSD: { CAD: '1.36' } }); // No EUR→USD

    const result = assertErr(await buildCanadaTaxValuation(price, quantity, timestamp, fxProvider));

    expect(result.message).toContain('Failed to normalize EUR price to USD');
  });
});

describe('createFiatIdentityPrice', () => {
  it('should return a price of 1 for the given currency', () => {
    const price = createFiatIdentityPrice('CAD' as Currency, timestamp);

    expect(price.price.amount.toFixed()).toBe('1');
    expect(price.price.currency).toBe('CAD');
    expect(price.quotedPrice!.amount.toFixed()).toBe('1');
    expect(price.quotedPrice!.currency).toBe('CAD');
    expect(price.source).toBe('fiat-identity');
  });
});

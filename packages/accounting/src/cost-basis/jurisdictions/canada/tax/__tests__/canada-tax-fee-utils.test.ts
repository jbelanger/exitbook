import type { Currency, PriceAtTxTime } from '@exitbook/core';
import { err, ok, parseDecimal } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import type { IFxRateProvider } from '../../../../../price-enrichment/shared/types.js';
import { buildValuedFee } from '../canada-tax-fee-utils.js';

function createFxProvider(fromUSD?: Record<string, string>): IFxRateProvider {
  return {
    getRateToUSD: async () => err(new Error('not implemented')),
    getRateFromUSD: async (currency: Currency) => {
      const rate = fromUSD?.[currency];
      if (!rate) return err(new Error(`No fromUSD rate for ${currency}`));
      return ok({ rate: parseDecimal(rate), source: 'test', fetchedAt: new Date() });
    },
  };
}

const identityConfig = {
  taxAssetIdentityPolicy: 'strict-onchain-tokens' as const,
  relaxedTaxIdentitySymbols: [] as string[],
};

const timestamp = new Date('2024-06-15T12:00:00Z');

describe('buildValuedFee', () => {
  it('should value a fiat fee without priceAtTxTime using identity price', async () => {
    const fee = {
      amount: parseDecimal('10'),
      assetId: 'fiat:cad',
      assetSymbol: 'CAD' as Currency,
    };
    const fxProvider = createFxProvider();

    const result = assertOk(await buildValuedFee({ fee, timestamp, fxProvider, identityConfig }));

    expect(result.feeAssetSymbol).toBe('CAD');
    expect(result.feeQuantity.toFixed()).toBe('10');
    expect(result.feeAssetIdentityKey).toBeUndefined();
    expect(result.valuation.taxCurrency).toBe('CAD');
  });

  it('should value a crypto fee with priceAtTxTime', async () => {
    const priceAtTxTime: PriceAtTxTime = {
      price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
      source: 'test',
      fetchedAt: timestamp,
      granularity: 'exact',
    };
    const fee = {
      amount: parseDecimal('0.001'),
      assetId: 'exchange:kraken:btc',
      assetSymbol: 'BTC' as Currency,
      priceAtTxTime,
    };
    const fxProvider = createFxProvider({ CAD: '1.36' });

    const result = assertOk(await buildValuedFee({ fee, timestamp, fxProvider, identityConfig }));

    expect(result.feeAssetIdentityKey).toBe('btc');
    expect(result.feeAssetSymbol).toBe('BTC');
    expect(result.valuation.valuationSource).toBe('usd-to-cad-fx');
  });

  it('should return error for crypto fee without priceAtTxTime', async () => {
    const fee = {
      amount: parseDecimal('0.001'),
      assetId: 'exchange:kraken:btc',
      assetSymbol: 'BTC' as Currency,
    };
    const fxProvider = createFxProvider();

    const result = assertErr(await buildValuedFee({ fee, timestamp, fxProvider, identityConfig }));

    expect(result.message).toContain('Missing priceAtTxTime');
    expect(result.message).toContain('BTC');
  });
});

import type { PriceAtTxTime } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, isFiat, ok, parseDecimal, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { IFxRateProvider } from '../../../../price-enrichment/shared/types.js';

import type { CanadaTaxValuation } from './canada-tax-types.js';

export function normalizeDecimal(value: Decimal): Decimal {
  return value.abs().lt(parseDecimal('1e-18')) ? parseDecimal('0') : value;
}

export async function buildCanadaTaxValuation(params: {
  fxProvider: IFxRateProvider;
  priceAtTxTime: PriceAtTxTime;
  quantity: Decimal;
  timestamp: Date;
}): Promise<Result<CanadaTaxValuation, Error>> {
  const { fxProvider, priceAtTxTime, quantity, timestamp } = params;
  const quotedPrice = priceAtTxTime.quotedPrice ?? priceAtTxTime.price;

  if (quotedPrice.currency === 'CAD') {
    return ok({
      taxCurrency: 'CAD',
      storagePriceAmount: priceAtTxTime.price.amount,
      storagePriceCurrency: priceAtTxTime.price.currency,
      quotedPriceAmount: quotedPrice.amount,
      quotedPriceCurrency: quotedPrice.currency,
      unitValueCad: quotedPrice.amount,
      totalValueCad: quotedPrice.amount.times(quantity),
      valuationSource: priceAtTxTime.quotedPrice ? 'quoted-price' : 'stored-price',
      fxRateToCad: undefined,
      fxSource: priceAtTxTime.fxSource,
      fxTimestamp: priceAtTxTime.fxTimestamp,
    });
  }

  if (priceAtTxTime.price.currency === 'CAD') {
    return ok({
      taxCurrency: 'CAD',
      storagePriceAmount: priceAtTxTime.price.amount,
      storagePriceCurrency: priceAtTxTime.price.currency,
      quotedPriceAmount: quotedPrice.amount,
      quotedPriceCurrency: quotedPrice.currency,
      unitValueCad: priceAtTxTime.price.amount,
      totalValueCad: priceAtTxTime.price.amount.times(quantity),
      valuationSource: 'stored-price',
      fxRateToCad: undefined,
      fxSource: priceAtTxTime.fxSource,
      fxTimestamp: priceAtTxTime.fxTimestamp,
    });
  }

  if (priceAtTxTime.price.currency === 'USD') {
    const usdToCadResult = await fxProvider.getRateFromUSD('CAD' as Currency, timestamp);
    if (usdToCadResult.isErr()) {
      return err(
        new Error(`Failed to convert USD price to CAD at ${timestamp.toISOString()}: ${usdToCadResult.error.message}`)
      );
    }

    const usdToCad = usdToCadResult.value;

    return ok({
      taxCurrency: 'CAD',
      storagePriceAmount: priceAtTxTime.price.amount,
      storagePriceCurrency: priceAtTxTime.price.currency,
      quotedPriceAmount: quotedPrice.amount,
      quotedPriceCurrency: quotedPrice.currency,
      unitValueCad: priceAtTxTime.price.amount.times(usdToCad.rate),
      totalValueCad: priceAtTxTime.price.amount.times(usdToCad.rate).times(quantity),
      valuationSource: 'usd-to-cad-fx',
      fxRateToCad: usdToCad.rate,
      fxSource: usdToCad.source,
      fxTimestamp: usdToCad.fetchedAt,
    });
  }

  if (isFiat(priceAtTxTime.price.currency)) {
    const toUsdResult = await fxProvider.getRateToUSD(priceAtTxTime.price.currency, timestamp);
    if (toUsdResult.isErr()) {
      return err(
        new Error(
          `Failed to normalize ${priceAtTxTime.price.currency} price to USD at ${timestamp.toISOString()}: ` +
            toUsdResult.error.message
        )
      );
    }

    const usdToCadResult = await fxProvider.getRateFromUSD('CAD' as Currency, timestamp);
    if (usdToCadResult.isErr()) {
      return err(
        new Error(`Failed to convert USD price to CAD at ${timestamp.toISOString()}: ${usdToCadResult.error.message}`)
      );
    }

    const cadPerUnit = priceAtTxTime.price.amount.times(toUsdResult.value.rate).times(usdToCadResult.value.rate);
    return ok({
      taxCurrency: 'CAD',
      storagePriceAmount: priceAtTxTime.price.amount,
      storagePriceCurrency: priceAtTxTime.price.currency,
      quotedPriceAmount: quotedPrice.amount,
      quotedPriceCurrency: quotedPrice.currency,
      unitValueCad: cadPerUnit,
      totalValueCad: cadPerUnit.times(quantity),
      valuationSource: 'fiat-to-cad-fx',
      fxRateToCad: toUsdResult.value.rate.times(usdToCadResult.value.rate),
      fxSource: `${toUsdResult.value.source}+${usdToCadResult.value.source}`,
      fxTimestamp: usdToCadResult.value.fetchedAt,
    });
  }

  return err(
    new Error(`Canada tax valuation requires fiat or USD price data, received ${priceAtTxTime.price.currency}`)
  );
}

export function createFiatIdentityPrice(assetSymbol: Currency, timestamp: Date): PriceAtTxTime {
  return {
    price: { amount: parseDecimal('1'), currency: assetSymbol },
    quotedPrice: { amount: parseDecimal('1'), currency: assetSymbol },
    source: 'fiat-identity',
    fetchedAt: timestamp,
    granularity: 'exact',
  };
}

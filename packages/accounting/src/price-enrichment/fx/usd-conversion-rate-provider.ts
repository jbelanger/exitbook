/**
 * USD-anchored fiat conversion backed by the shared price provider runtime.
 *
 * Accounting stores fiat normalization in USD, so this service only supports
 * currency -> USD and USD -> currency conversions.
 */

import type { Currency, Result } from '@exitbook/foundation';
import { err, ok, parseDecimal } from '@exitbook/foundation';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import type { FxRateData } from '../shared/types.js';

export class UsdConversionRateProvider {
  constructor(private readonly priceRuntime: IPriceProviderRuntime) {}

  async getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    const fxRateResult = await this.priceRuntime.fetchPrice({
      assetSymbol: sourceCurrency,
      currency: 'USD' as Currency,
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(
        new Error(`Failed to fetch FX rate for ${sourceCurrency.toString()} -> USD: ${fxRateResult.error.message}`)
      );
    }

    const fxData = fxRateResult.value;

    return ok({
      rate: fxData.price,
      source: fxData.source,
      fetchedAt: fxData.fetchedAt,
    });
  }

  async getRateFromUSD(targetCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    const fxRateResult = await this.priceRuntime.fetchPrice({
      assetSymbol: targetCurrency,
      currency: 'USD' as Currency,
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(
        new Error(`Failed to fetch FX rate for USD -> ${targetCurrency.toString()}: ${fxRateResult.error.message}`)
      );
    }

    const fxData = fxRateResult.value;
    const rateToUsd = fxData.price;

    if (rateToUsd.isZero()) {
      return err(new Error(`Cannot invert zero FX rate for ${targetCurrency.toString()} -> USD`));
    }

    return ok({
      rate: parseDecimal(1).div(rateToUsd),
      source: fxData.source,
      fetchedAt: fxData.fetchedAt,
    });
  }
}

export type UsdConversionRateProviderLike = Pick<UsdConversionRateProvider, 'getRateFromUSD' | 'getRateToUSD'>;

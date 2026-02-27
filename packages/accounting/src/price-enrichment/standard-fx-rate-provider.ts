/**
 * Standard FX rate provider using PriceProviderManager
 *
 * This implementation fetches FX rates from external providers (ECB, Bank of Canada)
 * using the unified price provider infrastructure.
 */

import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { PriceProviderManager } from '@exitbook/price-providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { FxRateData, IFxRateProvider } from './types.js';

/**
 * Standard implementation that delegates to PriceProviderManager
 */
export class StandardFxRateProvider implements IFxRateProvider {
  constructor(private readonly priceManager: PriceProviderManager) {}

  async getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    // Fetch FX rate from provider manager
    // ProviderManager scores candidates per request (asset support, health, granularity)
    // so EUR typically hits ECB first, CAD hits Bank of Canada, with Frankfurter as fallback.
    const fxRateResult = await this.priceManager.fetchPrice({
      assetSymbol: sourceCurrency,
      currency: 'USD' as Currency,
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(
        new Error(`Failed to fetch FX rate for ${sourceCurrency.toString()} → USD: ${fxRateResult.error.message}`)
      );
    }

    const fxData = fxRateResult.value.data;

    return ok({
      rate: fxData.price,
      source: fxData.source,
      fetchedAt: fxData.fetchedAt,
    });
  }

  async getRateFromUSD(targetCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    // To get USD → target, we fetch target → USD and invert the rate
    // Example: CAD → USD = 0.74, so USD → CAD = 1/0.74 = 1.35
    const fxRateResult = await this.priceManager.fetchPrice({
      assetSymbol: targetCurrency,
      currency: 'USD' as Currency,
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(
        new Error(`Failed to fetch FX rate for USD → ${targetCurrency.toString()}: ${fxRateResult.error.message}`)
      );
    }

    const fxData = fxRateResult.value.data;
    const rateToUsd = fxData.price;

    // Invert the rate: if CAD → USD = 0.74, then USD → CAD = 1/0.74
    if (rateToUsd.isZero()) {
      return err(new Error(`Cannot invert zero FX rate for ${targetCurrency.toString()} → USD`));
    }

    const rateFromUsd = parseDecimal(1).div(rateToUsd);

    return ok({
      rate: rateFromUsd,
      source: fxData.source,
      fetchedAt: fxData.fetchedAt,
    });
  }
}

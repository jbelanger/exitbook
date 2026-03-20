/**
 * Standard FX rate provider using a historical asset price source
 *
 * This implementation fetches FX rates from external providers (ECB, Bank of Canada)
 * using the host-composed historical price source.
 */

import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';

import type { IHistoricalAssetPriceSource } from '../../ports/historical-asset-price-source.js';
import type { FxRateData, IFxRateProvider } from '../shared/types.js';

/**
 * Standard implementation that delegates to a historical asset price source.
 */
export class StandardFxRateProvider implements IFxRateProvider {
  constructor(private readonly historicalAssetPriceSource: IHistoricalAssetPriceSource) {}

  async getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    // Fetch FX rate from the host-composed price source.
    // The source may still be backed by PriceProviderManager, which scores candidates
    // per request (asset support, health, granularity).
    // so EUR typically hits ECB first, CAD hits Bank of Canada, with Frankfurter as fallback.
    const fxRateResult = await this.historicalAssetPriceSource.fetchPrice({
      assetSymbol: sourceCurrency,
      currency: 'USD' as Currency,
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(
        new Error(`Failed to fetch FX rate for ${sourceCurrency.toString()} → USD: ${fxRateResult.error.message}`)
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
    // To get USD → target, we fetch target → USD and invert the rate
    // Example: CAD → USD = 0.74, so USD → CAD = 1/0.74 = 1.35
    const fxRateResult = await this.historicalAssetPriceSource.fetchPrice({
      assetSymbol: targetCurrency,
      currency: 'USD' as Currency,
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(
        new Error(`Failed to fetch FX rate for USD → ${targetCurrency.toString()}: ${fxRateResult.error.message}`)
      );
    }

    const fxData = fxRateResult.value;
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

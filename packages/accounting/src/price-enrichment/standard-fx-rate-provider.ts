/**
 * Standard FX rate provider using PriceProviderManager
 *
 * This implementation fetches FX rates from external providers (ECB, Bank of Canada)
 * using the unified price provider infrastructure.
 */

import type { Currency } from '@exitbook/core';
import { Currency as CurrencyClass } from '@exitbook/core';
import type { PriceProviderManager } from '@exitbook/platform-price-providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { FxRateData, IFxRateProvider } from './fx-rate-provider.interface.ts';

/**
 * Standard implementation that delegates to PriceProviderManager
 */
export class StandardFxRateProvider implements IFxRateProvider {
  constructor(private readonly priceManager: PriceProviderManager) {}

  async getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    // Fetch FX rate from provider manager
    // The manager will try providers in order: ECB → Bank of Canada → Frankfurter
    const fxRateResult = await this.priceManager.fetchPrice({
      asset: sourceCurrency,
      currency: CurrencyClass.create('USD'),
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
}

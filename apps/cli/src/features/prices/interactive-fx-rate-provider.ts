/**
 * Interactive FX rate provider
 *
 * Wraps StandardFxRateProvider and prompts user for manual FX rate entry
 * when providers fail to fetch rates. This implements the CLI layer's
 * interactive behavior without coupling the domain service to UI concerns.
 */

import type { FxRateData, IFxRateProvider } from '@exitbook/accounting';
import type { Currency } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import { promptManualFxRate } from './prices-prompts.ts';

/**
 * Interactive FX rate provider
 *
 * Delegates to underlying provider (typically StandardFxRateProvider).
 * When underlying provider fails, prompts user for manual entry if
 * interactive mode is enabled.
 */
export class InteractiveFxRateProvider implements IFxRateProvider {
  constructor(
    private readonly underlyingProvider: IFxRateProvider,
    private readonly interactive: boolean
  ) {}

  async getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>> {
    // Try underlying provider first (e.g., ECB, Bank of Canada)
    const result = await this.underlyingProvider.getRateToUSD(sourceCurrency, timestamp);

    // If successful, return immediately
    if (result.isOk()) {
      return result;
    }

    // If not interactive, return the error
    if (!this.interactive) {
      return result;
    }

    // Interactive mode: prompt user for manual entry
    const manualRate = await promptManualFxRate(sourceCurrency.toString(), 'USD', timestamp);

    // User declined to provide manual rate
    if (!manualRate) {
      return result; // Return original error
    }

    // User provided manual rate - return it
    return ok({
      rate: manualRate.rate,
      source: manualRate.source,
      fetchedAt: new Date(), // Current time for manual entry
    });
  }
}

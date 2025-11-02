import { Currency, parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/shared-logger';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok, okAsync } from 'neverthrow';

const logger = getLogger('FxRateProvider');

/**
 * FX rate with metadata for audit trail
 */
export interface FxRate {
  rate: Decimal; // Exchange rate (e.g., 1.08 for EUR to USD)
  source: string; // Source of rate (e.g., "coingecko", "ecb", "manual")
  timestamp: Date; // When rate was fetched
}

/**
 * FX Rate Provider Service
 *
 * Provides foreign exchange rates for converting fiat currencies to USD.
 * Used during transaction import/normalization to track FX conversions.
 *
 * MVP Implementation:
 * - Converts fiat currencies to USD only
 * - Uses CoinGecko for rates (they provide fiat exchange rates)
 * - Graceful degradation: returns error for missing rates
 * - Manual rate entry supported via constructor injection
 *
 * Future Enhancements:
 * - Dedicated FX provider (ECB, Fixer.io) for official rates
 * - Rate caching for same-day requests
 * - Support for other base currencies (EUR, CAD, etc.)
 */
export class FxRateProvider {
  private readonly manualRates: Map<string, Decimal>;

  constructor(manualRates = new Map<string, Decimal>()) {
    // Normalize keys to uppercase to match Currency.create behavior
    this.manualRates = new Map(Array.from(manualRates.entries()).map(([k, v]) => [Currency.create(k).toString(), v]));
  }

  /**
   * Get FX rate to convert from sourceCurrency to USD
   *
   * @param sourceCurrency - Source fiat currency (e.g., "EUR", "CAD")
   * @param datetime - Transaction datetime (for historical rates)
   * @returns FX rate with metadata, or error if rate unavailable
   */
  async getRateToUSD(sourceCurrency: string, datetime: Date): Promise<Result<FxRate, Error>> {
    const currency = Currency.create(sourceCurrency);

    // USD doesn't need conversion
    if (currency.toString() === 'USD') {
      return ok({
        rate: parseDecimal('1'),
        source: 'identity',
        timestamp: datetime,
      });
    }

    // Check if it's a fiat currency
    if (!currency.isFiat()) {
      return err(new Error(`Cannot get FX rate for non-fiat currency: ${sourceCurrency}`));
    }

    // Check manual rates first
    const manualRate = this.manualRates.get(currency.toString());
    if (manualRate) {
      logger.debug({ currency: sourceCurrency, rate: manualRate.toString() }, 'Using manual FX rate');
      return okAsync({
        rate: manualRate,
        source: 'manual',
        timestamp: datetime,
      });
    }

    // TODO: Implement CoinGecko or dedicated FX provider integration
    // For now, return error for missing rates (graceful degradation)
    logger.warn(
      {
        currency: sourceCurrency,
        datetime: datetime.toISOString(),
      },
      'FX rate not available - provider integration pending'
    );

    return err(
      new Error(
        `FX rate unavailable for ${sourceCurrency} at ${datetime.toISOString()}. ` +
          `Add manual rate or implement FX provider integration.`
      )
    );
  }

  /**
   * Convert an amount from sourceCurrency to USD
   *
   * @param amount - Amount in source currency
   * @param sourceCurrency - Source fiat currency
   * @param datetime - Transaction datetime
   * @returns Converted amount and FX metadata, or error if rate unavailable
   */
  async convertToUSD(
    amount: Decimal,
    sourceCurrency: string,
    datetime: Date
  ): Promise<
    Result<
      {
        convertedAmount: Decimal;
        fxRate: Decimal;
        fxSource: string;
        fxTimestamp: Date;
      },
      Error
    >
  > {
    const rateResult = await this.getRateToUSD(sourceCurrency, datetime);

    if (rateResult.isErr()) {
      return err(rateResult.error);
    }

    const { rate, source, timestamp } = rateResult.value;
    const convertedAmount = amount.times(rate);

    return ok({
      convertedAmount,
      fxRate: rate,
      fxSource: source,
      fxTimestamp: timestamp,
    });
  }

  /**
   * Add a manual FX rate for a currency
   * Useful for:
   * - Testing
   * - Historical rates not available from providers
   * - User-provided rates for accuracy
   *
   * @param currency - Currency code (e.g., "EUR")
   * @param rateToUSD - Exchange rate to USD (e.g., 1.08 for EUR)
   */
  addManualRate(currency: string, rateToUSD: Decimal): void {
    const curr = Currency.create(currency);
    if (!curr.isFiat()) {
      throw new Error(`Cannot add FX rate for non-fiat currency: ${currency}`);
    }
    this.manualRates.set(curr.toString(), rateToUSD);
    logger.info({ currency: curr.toString(), rate: rateToUSD.toString() }, 'Added manual FX rate');
  }

  /**
   * Check if a rate is available for a currency
   */
  async hasRate(currency: string, datetime: Date): Promise<boolean> {
    const result = await this.getRateToUSD(currency, datetime);
    return result.isOk();
  }
}

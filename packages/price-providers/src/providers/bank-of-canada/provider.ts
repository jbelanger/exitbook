/**
 * Bank of Canada FX rate provider implementation
 *
 * Provides CAD/USD exchange rates from Bank of Canada's Valet API
 * API Documentation: https://www.bankofcanada.ca/valet/docs
 */

import { isFiat, type Currency, wrapError } from '@exitbook/core';
import type { HttpClient } from '@exitbook/http';
import type { InstrumentationCollector } from '@exitbook/observability';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { BasePriceProvider } from '../../core/base-provider.js';
import type { ProviderRateLimitConfig } from '../../core/utils.js';
import { createProviderHttpClient } from '../../core/utils.js';
import type { ProviderMetadata, PriceQuery, PriceData } from '../../index.js';
import type { PricesDB } from '../../persistence/database.js';
import { createPriceQueries, type PriceQueries } from '../../persistence/queries/price-queries.js';
import { BusinessDayFallbackExhaustedError, fetchWithBusinessDayFallback } from '../shared/fx-fallback-utils.js';

import { formatBoCDate, transformBoCResponse } from './boc-utils.js';
import { BankOfCanadaResponseSchema } from './schemas.js';

/**
 * Bank of Canada API rate limits (conservative estimates)
 * BoC doesn't publish official rate limits but recommends reasonable use
 */
const BOC_RATE_LIMIT: ProviderRateLimitConfig = {
  burstLimit: 5,
  requestsPerHour: 300,
  requestsPerMinute: 10,
  requestsPerSecond: 0.2, // ~12 per minute
};

/**
 * Create a fully configured Bank of Canada provider
 *
 * @param db - Initialized prices database instance
 * @param config - Provider configuration (none required for BoC)
 */
export function createBankOfCanadaProvider(
  db: PricesDB,
  _config: unknown = {},
  instrumentation?: InstrumentationCollector
): Result<BankOfCanadaProvider, Error> {
  try {
    // Bank of Canada Valet API base URL
    const baseUrl = 'https://www.bankofcanada.ca/valet';

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl,
      instrumentation,
      providerName: 'BankOfCanada',
      rateLimit: BOC_RATE_LIMIT,
    });

    // Create queries
    const priceQueries = createPriceQueries(db);

    // Create provider
    const provider = new BankOfCanadaProvider(httpClient, priceQueries);

    return ok(provider);
  } catch (error) {
    return err(
      new Error(`Failed to create Bank of Canada provider: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Bank of Canada FX rate provider
 *
 * Provides daily CAD/USD exchange rates
 * Historical data available back to 2017 (Valet API limitation)
 * No API key required
 */
export class BankOfCanadaProvider extends BasePriceProvider {
  protected metadata: ProviderMetadata;

  constructor(httpClient: HttpClient, priceQueries: PriceQueries) {
    super(httpClient, priceQueries);

    // Provider metadata
    this.metadata = {
      name: 'bank-of-canada',
      displayName: 'Bank of Canada',
      capabilities: {
        supportedOperations: ['fetchPrice'],
        supportedAssetTypes: ['fiat'],
        supportedAssets: ['CAD'], // Only CAD/USD pair
        rateLimit: {
          burstLimit: BOC_RATE_LIMIT.burstLimit,
          requestsPerHour: BOC_RATE_LIMIT.requestsPerHour,
          requestsPerMinute: BOC_RATE_LIMIT.requestsPerMinute,
          requestsPerSecond: BOC_RATE_LIMIT.requestsPerSecond,
        },
        granularitySupport: [
          {
            granularity: 'day',
            maxHistoryDays: undefined, // Historical data back to 2017 via Valet API
            limitation: 'Bank of Canada provides daily exchange rates (no intraday granularity)',
          },
        ],
      },
      requiresApiKey: false,
    };
  }

  /**
   * Fetch FX rate (implements BasePriceProvider)
   * Query is already validated and currency is normalized by BasePriceProvider
   */
  protected async fetchPriceInternal(query: PriceQuery): Promise<Result<PriceData, Error>> {
    try {
      const { assetSymbol: asset, currency, timestamp } = query;

      // Validate: asset must be CAD
      if (!isFiat(asset) || asset !== 'CAD') {
        return err(new Error(`Bank of Canada only supports CAD currency, got ${asset}`));
      }

      // Validate: currency must be USD
      if (currency !== 'USD') {
        return err(new Error(`Bank of Canada only supports USD as target currency, got ${currency}`));
      }

      // 1. Check cache using shared helper
      const cachedResult = await this.checkCache(query, currency);
      if (cachedResult.isErr()) {
        return err(cachedResult.error);
      }
      if (cachedResult.value) {
        return ok(cachedResult.value);
      }

      // 2. Fetch from API
      const priceData = await this.fetchFromApi(asset, timestamp, currency);
      if (priceData.isErr()) {
        return err(priceData.error);
      }

      // 3. Cache the result using shared helper
      await this.saveToCache(priceData.value, 'CAD_USD');

      return ok(priceData.value);
    } catch (error) {
      return wrapError(error, 'Failed to fetch Bank of Canada FX rate');
    }
  }

  /**
   * Fetch FX rate from Bank of Canada API with fallback for weekends/holidays
   *
   * BoC only publishes rates on business days. For weekend/holiday requests,
   * walk back to find the most recent available rate.
   */
  private async fetchFromApi(
    assetSymbol: Currency,
    timestamp: Date,
    currency: Currency
  ): Promise<Result<PriceData, Error>> {
    const requestedDate = formatBoCDate(timestamp);
    const fallbackResult = await fetchWithBusinessDayFallback(timestamp, {
      maxAttempts: 7,
      fetchForDate: async ({ attemptNumber, candidateDate, isOriginalDate }) => {
        const dateStr = formatBoCDate(candidateDate);

        // Build query parameters
        const params = new URLSearchParams({
          start_date: dateStr,
          end_date: dateStr,
        });

        this.logger.debug(
          {
            assetSymbol,
            currency,
            requestedDate,
            attemptDate: dateStr,
            attempt: attemptNumber,
          },
          isOriginalDate ? 'Fetching BoC FX rate' : 'Retrying BoC FX rate with earlier date'
        );

        // Make API request
        // Full endpoint: https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2024-01-01&end_date=2024-01-01
        // Note: BoC provides USD/CAD (how many CAD per USD), we convert to CAD/USD (how many USD per CAD)
        const httpResult = await this.httpClient.get<unknown>(`/observations/FXUSDCAD/json?${params.toString()}`);
        if (httpResult.isErr()) {
          // For HTTP errors, don't retry - fail immediately
          return { error: httpResult.error, outcome: 'fail' } as const;
        }

        const parseResult = BankOfCanadaResponseSchema.safeParse(httpResult.value);
        if (!parseResult.success) {
          return {
            error: new Error(`Invalid Bank of Canada response: ${parseResult.error.message}`),
            outcome: 'fail',
          } as const;
        }

        const now = new Date();
        const priceDataResult = transformBoCResponse(parseResult.data, assetSymbol, candidateDate, currency, now);
        if (priceDataResult.isErr()) {
          return { error: priceDataResult.error, outcome: 'retry' } as const;
        }

        return { outcome: 'success', value: priceDataResult.value } as const;
      },
    });

    if (fallbackResult.isErr()) {
      if (fallbackResult.error instanceof BusinessDayFallbackExhaustedError) {
        return err(
          new Error(
            `No FX rate found for ${assetSymbol} within ${fallbackResult.error.maxAttempts} days of ${requestedDate}. ` +
              `Last error: ${fallbackResult.error.lastError?.message || 'unknown'}`
          )
        );
      }
      return err(fallbackResult.error);
    }

    const { actualDate, daysBack, value: priceData } = fallbackResult.value;
    if (daysBack > 0) {
      this.logger.info(
        {
          assetSymbol: assetSymbol.toString(),
          requestedDate,
          actualDate: formatBoCDate(actualDate),
          daysBack,
        },
        'Using previous business day FX rate (weekend/holiday)'
      );

      return ok({
        ...priceData,
        granularity: 'day',
        timestamp,
      });
    }

    return ok(priceData);
  }
}

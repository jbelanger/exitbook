/**
 * Frankfurter FX rate provider implementation
 *
 * Provides foreign exchange rates from Frankfurter API (ECB import session)
 * API Documentation: https://www.frankfurter.app/docs/
 *
 * Advantages over direct ECB API:
 * - Simpler API with cleaner JSON responses
 * - Supports conversion between any currency pair (not just EUR base)
 * - Historical data back to 1999 (ECB reference rates)
 * - No API key required, no rate limits
 * - More comprehensive currency support (31 currencies)
 */

import { isFiat, parseDecimal, wrapError, type Currency } from '@exitbook/core';
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

import {
  formatFrankfurterDate,
  FRANKFURTER_SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  transformFrankfurterResponse,
} from './frankfurter-utils.js';
import { FrankfurterSingleDateResponseSchema } from './schemas.js';

/**
 * Frankfurter API rate limits
 * Frankfurter has no published rate limits - it's a free public service
 * Using conservative estimates to be respectful
 */
const FRANKFURTER_RATE_LIMIT: ProviderRateLimitConfig = {
  burstLimit: 10,
  requestsPerHour: 1000,
  requestsPerMinute: 30,
  requestsPerSecond: 1,
};

/**
 * Create a fully configured Frankfurter provider
 *
 * @param db - Initialized prices database instance
 * @param config - Provider configuration (none required for Frankfurter)
 */
export function createFrankfurterProvider(
  db: PricesDB,
  _config: unknown = {},
  instrumentation?: InstrumentationCollector
): Result<FrankfurterProvider, Error> {
  try {
    // Frankfurter API base URL (v1 API)
    const baseUrl = 'https://api.frankfurter.dev/v1';

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl,
      instrumentation,
      providerName: 'Frankfurter',
      rateLimit: FRANKFURTER_RATE_LIMIT,
    });

    // Create queries
    const priceQueries = createPriceQueries(db);

    // Create provider
    const provider = new FrankfurterProvider(httpClient, priceQueries);

    return ok(provider);
  } catch (error) {
    return err(
      new Error(`Failed to create Frankfurter provider: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Frankfurter FX rate provider
 *
 * Provides daily exchange rates for 31 major currencies
 * Historical data available back to 1999 (ECB reference rates)
 * No API key required, no official rate limits
 */
export class FrankfurterProvider extends BasePriceProvider {
  protected metadata: ProviderMetadata;

  constructor(httpClient: HttpClient, priceQueries: PriceQueries) {
    super(httpClient, priceQueries);

    // Provider metadata
    this.metadata = {
      name: 'frankfurter',
      displayName: 'Frankfurter (ECB)',
      capabilities: {
        supportedOperations: ['fetchPrice'],
        supportedAssetTypes: ['fiat'],
        supportedAssets: [...FRANKFURTER_SUPPORTED_CURRENCIES],
        rateLimit: {
          burstLimit: FRANKFURTER_RATE_LIMIT.burstLimit,
          requestsPerHour: FRANKFURTER_RATE_LIMIT.requestsPerHour,
          requestsPerMinute: FRANKFURTER_RATE_LIMIT.requestsPerMinute,
          requestsPerSecond: FRANKFURTER_RATE_LIMIT.requestsPerSecond,
        },
        granularitySupport: [
          {
            granularity: 'day',
            maxHistoryDays: undefined, // Historical data back to 1999
            limitation: 'Frankfurter provides daily exchange rates (no intraday granularity)',
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
      const { assetSymbol: assetSymbol, currency, timestamp } = query;

      // Validate: asset must be a supported fiat currency
      if (!isFiat(assetSymbol) || !isSupportedCurrency(assetSymbol)) {
        return err(
          new Error(
            `Frankfurter only supports fiat currencies: ${FRANKFURTER_SUPPORTED_CURRENCIES.join(', ')}, got ${assetSymbol}`
          )
        );
      }

      // Validate: currency must be USD
      if (currency !== 'USD') {
        return err(new Error(`Frankfurter provider only supports USD as target currency, got ${currency}`));
      }

      // Special case: USD to USD
      if (assetSymbol === 'USD') {
        return ok({
          assetSymbol: assetSymbol,
          timestamp,
          price: parseDecimal('1'),
          currency,
          source: 'frankfurter',
          fetchedAt: new Date(),
          granularity: 'day',
        });
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
      const priceData = await this.fetchFromApi(assetSymbol, timestamp, currency);
      if (priceData.isErr()) {
        return err(priceData.error);
      }

      // 3. Cache the result using shared helper
      await this.saveToCache(priceData.value, `${assetSymbol}_USD`);

      return ok(priceData.value);
    } catch (error) {
      return wrapError(error, 'Failed to fetch Frankfurter FX rate');
    }
  }

  /**
   * Fetch FX rate from Frankfurter API with fallback for weekends/holidays
   *
   * Frankfurter (like ECB) only publishes rates on business days.
   * For weekend/holiday requests, walk back to find the most recent available rate.
   */
  private async fetchFromApi(
    assetSymbol: Currency,
    timestamp: Date,
    currency: Currency
  ): Promise<Result<PriceData, Error>> {
    const requestedDate = formatFrankfurterDate(timestamp);
    const fallbackResult = await fetchWithBusinessDayFallback(timestamp, {
      maxAttempts: 7,
      fetchForDate: async ({ attemptNumber, candidateDate, isOriginalDate }) => {
        const dateStr = formatFrankfurterDate(candidateDate);

        // Build query parameters
        const params = new URLSearchParams({
          from: assetSymbol,
          to: currency,
        });

        this.logger.debug(
          {
            assetSymbol,
            currency,
            requestedDate,
            attemptDate: dateStr,
            attempt: attemptNumber,
          },
          isOriginalDate ? 'Fetching Frankfurter FX rate' : 'Retrying Frankfurter FX rate with earlier date'
        );

        // Make API request: GET /{date}?from={asset}&to={currency}
        const httpResult = await this.httpClient.get<unknown>(`/${dateStr}?${params.toString()}`);

        if (httpResult.isErr()) {
          // For HTTP errors, try earlier date (might be weekend/holiday)
          // unless it's a 4xx error (client error - likely invalid currency)
          const errorMsg = httpResult.error.message;
          if (errorMsg.includes('400') || errorMsg.includes('404')) {
            return { error: httpResult.error, outcome: 'fail' } as const;
          }
          return { error: httpResult.error, outcome: 'retry' } as const;
        }

        const parseResult = FrankfurterSingleDateResponseSchema.safeParse(httpResult.value);
        if (!parseResult.success) {
          return {
            error: new Error(`Invalid Frankfurter response: ${parseResult.error.message}`),
            outcome: 'fail',
          } as const;
        }

        const now = new Date();
        const priceDataResult = transformFrankfurterResponse(
          parseResult.data,
          assetSymbol,
          currency,
          candidateDate,
          now
        );
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
          assetSymbol,
          requestedDate,
          actualDate: formatFrankfurterDate(actualDate),
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

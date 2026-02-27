/**
 * European Central Bank (ECB) FX rate provider implementation
 *
 * Provides foreign exchange rates from ECB's official data portal
 * API Documentation: https://data.ecb.europa.eu/help/api/overview
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

import { buildECBFlowRef, formatECBDate, transformECBResponse } from './ecb-utils.js';
import { ECBExchangeRateResponseSchema } from './schemas.js';

/**
 * ECB API rate limits (conservative estimates)
 * ECB doesn't publish official rate limits but recommends reasonable use
 */
const ECB_RATE_LIMIT: ProviderRateLimitConfig = {
  burstLimit: 5,
  requestsPerHour: 300,
  requestsPerMinute: 10,
  requestsPerSecond: 0.2, // ~12 per minute
};

/**
 * Create a fully configured ECB provider
 *
 * @param db - Initialized prices database instance
 * @param config - Provider configuration (none required for ECB)
 */
export function createECBProvider(
  db: PricesDB,
  _config: unknown = {},
  instrumentation?: InstrumentationCollector
): Result<ECBProvider, Error> {
  try {
    // ECB API base URL
    const baseUrl = 'https://data-api.ecb.europa.eu/service/data/EXR';

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl,
      instrumentation,
      providerName: 'ECB',
      rateLimit: ECB_RATE_LIMIT,
    });

    // Create queries
    const priceQueries = createPriceQueries(db);

    // Create provider
    const provider = new ECBProvider(httpClient, priceQueries);

    return ok(provider);
  } catch (error) {
    return err(new Error(`Failed to create ECB provider: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * European Central Bank (ECB) FX rate provider
 *
 * Provides daily exchange rates for major currencies against USD
 * Historical data available back to 1999
 * No API key required
 */
export class ECBProvider extends BasePriceProvider {
  protected metadata: ProviderMetadata;

  constructor(httpClient: HttpClient, priceQueries: PriceQueries) {
    super(httpClient, priceQueries);

    // Provider metadata
    this.metadata = {
      name: 'ecb',
      displayName: 'European Central Bank',
      capabilities: {
        supportedOperations: ['fetchPrice'],
        supportedAssetTypes: ['fiat'],
        supportedAssets: ['EUR'], // ECB only provides EUR as base currency
        rateLimit: {
          burstLimit: ECB_RATE_LIMIT.burstLimit,
          requestsPerHour: ECB_RATE_LIMIT.requestsPerHour,
          requestsPerMinute: ECB_RATE_LIMIT.requestsPerMinute,
          requestsPerSecond: ECB_RATE_LIMIT.requestsPerSecond,
        },
        granularitySupport: [
          {
            granularity: 'day',
            maxHistoryDays: undefined, // Historical data back to 1999
            limitation: 'ECB provides daily exchange rates (no intraday granularity)',
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

      // Validate: asset must be EUR (ECB only provides EUR as base currency)
      if (!isFiat(asset) || asset !== 'EUR') {
        return err(new Error(`ECB only supports EUR currency, got ${asset}`));
      }

      // Validate: currency must be USD
      if (currency !== 'USD') {
        return err(new Error(`ECB only supports USD as target currency, got ${currency}`));
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
      await this.saveToCache(priceData.value, `${asset}_USD`);

      return ok(priceData.value);
    } catch (error) {
      return wrapError(error, 'Failed to fetch ECB FX rate');
    }
  }

  /**
   * Fetch FX rate from ECB API with fallback for weekends/holidays
   *
   * ECB only publishes rates on business days. For weekend/holiday requests,
   * walk back to find the most recent available rate.
   */
  private async fetchFromApi(
    assetSymbol: Currency,
    timestamp: Date,
    currency: Currency
  ): Promise<Result<PriceData, Error>> {
    // ECB format: D.{FOREIGN_CURRENCY}.EUR gives "foreign currency per EUR"
    // We want EUR→USD, so we need D.USD.EUR (USD per EUR)
    // Therefore: swap the parameters (currency first, asset second)
    const flowRef = buildECBFlowRef(currency, assetSymbol);
    const requestedDate = formatECBDate(timestamp);
    const fallbackResult = await fetchWithBusinessDayFallback(timestamp, {
      maxAttempts: 7,
      fetchForDate: async ({ attemptNumber, candidateDate, isOriginalDate }) => {
        const dateStr = formatECBDate(candidateDate);

        // Build query parameters
        const params = new URLSearchParams({
          startPeriod: dateStr,
          endPeriod: dateStr,
          format: 'jsondata',
        });

        this.logger.debug(
          {
            assetSymbol,
            currency,
            requestedDate,
            attemptDate: dateStr,
            attempt: attemptNumber,
          },
          isOriginalDate ? 'Fetching ECB FX rate' : 'Retrying ECB FX rate with earlier date'
        );

        const httpResult = await this.httpClient.get<unknown>(`/${flowRef}?${params.toString()}`);
        if (httpResult.isErr()) {
          // For HTTP errors, don't retry - fail immediately
          return { error: httpResult.error, outcome: 'fail' } as const;
        }

        const parseResult = ECBExchangeRateResponseSchema.safeParse(httpResult.value);
        if (!parseResult.success) {
          return { error: new Error(`Invalid ECB response: ${parseResult.error.message}`), outcome: 'fail' } as const;
        }

        const now = new Date();
        const priceDataResult = transformECBResponse(parseResult.data, assetSymbol, candidateDate, currency, now);
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
          actualDate: formatECBDate(actualDate),
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

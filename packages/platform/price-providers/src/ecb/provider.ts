/**
 * European Central Bank (ECB) FX rate provider implementation
 *
 * Provides foreign exchange rates from ECB's official data portal
 * API Documentation: https://data.ecb.europa.eu/help/api/overview
 */

import type { Currency } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { HttpClient } from '@exitbook/platform-http';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesDB } from '../persistence/database.ts';
import { PriceRepository } from '../persistence/repositories/price-repository.js';
import { BasePriceProvider } from '../shared/base-provider.js';
import { createProviderHttpClient, type ProviderRateLimitConfig } from '../shared/shared-utils.js';
import type { PriceData, PriceQuery, ProviderMetadata } from '../shared/types/index.js';

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
export function createECBProvider(db: PricesDB): Result<ECBProvider, Error> {
  try {
    // ECB API base URL
    const baseUrl = 'https://data-api.ecb.europa.eu/service/data/EXR';

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl,
      providerName: 'ECB',
      rateLimit: ECB_RATE_LIMIT,
    });

    // Create repository
    const priceRepo = new PriceRepository(db);

    // Create provider
    const provider = new ECBProvider(httpClient, priceRepo);

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
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient, priceRepo: PriceRepository) {
    super();

    this.httpClient = httpClient;
    this.priceRepo = priceRepo;

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
      const { asset, currency, timestamp } = query;

      // Validate: asset must be EUR (ECB only provides EUR as base currency)
      if (!asset.isFiat() || asset.toString() !== 'EUR') {
        return err(new Error(`ECB only supports EUR currency, got ${asset.toString()}`));
      }

      // Validate: currency must be USD
      if (currency.toString() !== 'USD') {
        return err(new Error(`ECB only supports USD as target currency, got ${currency.toString()}`));
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
      await this.saveToCache(priceData.value, `${asset.toString()}_USD`);

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
  private async fetchFromApi(asset: Currency, timestamp: Date, currency: Currency): Promise<Result<PriceData, Error>> {
    // ECB format: D.{FOREIGN_CURRENCY}.EUR gives "foreign currency per EUR"
    // We want EUR→USD, so we need D.USD.EUR (USD per EUR)
    // Therefore: swap the parameters (currency first, asset second)
    const flowRef = buildECBFlowRef(currency.toString(), asset.toString());
    const maxAttempts = 7; // Try up to a week back
    let attemptDate = new Date(timestamp);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const dateStr = formatECBDate(attemptDate);

      // Build query parameters
      const params = new URLSearchParams({
        startPeriod: dateStr,
        endPeriod: dateStr,
        format: 'jsondata',
      });

      const isOriginalDate = attempt === 0;
      this.logger.debug(
        {
          asset: asset.toString(),
          currency: currency.toString(),
          requestedDate: formatECBDate(timestamp),
          attemptDate: dateStr,
          attempt: attempt + 1,
        },
        isOriginalDate ? 'Fetching ECB FX rate' : 'Retrying ECB FX rate with earlier date'
      );

      // Make API request
      const httpResult = await this.httpClient.get<unknown>(`/${flowRef}?${params.toString()}`);

      if (httpResult.isErr()) {
        lastError = httpResult.error;
        // For HTTP errors, don't retry - fail immediately
        return err(httpResult.error);
      }

      const rawResponse = httpResult.value;

      // Validate response schema
      const parseResult = ECBExchangeRateResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid ECB response: ${parseResult.error.message}`));
      }

      // Transform response to PriceData
      const now = new Date();
      const priceDataResult = transformECBResponse(parseResult.data, asset, attemptDate, currency, now);

      if (priceDataResult.isOk()) {
        // Successfully found a rate
        const priceData = priceDataResult.value;

        // If we had to use a different date, update granularity and log
        if (!isOriginalDate) {
          this.logger.info(
            {
              asset: asset.toString(),
              requestedDate: formatECBDate(timestamp),
              actualDate: dateStr,
              daysBack: attempt,
            },
            'Using previous business day FX rate (weekend/holiday)'
          );

          return ok({
            ...priceData,
            granularity: 'day', // Still daily, just not exact date
            timestamp, // Keep original requested timestamp
          });
        }

        return ok(priceData);
      }

      // No data for this date - likely weekend/holiday
      // Walk back one day and try again
      lastError = priceDataResult.error;
      attemptDate = new Date(attemptDate.getTime() - 24 * 60 * 60 * 1000);
    }

    // Exhausted all attempts
    return err(
      new Error(
        `No FX rate found for ${asset.toString()} within ${maxAttempts} days of ${formatECBDate(timestamp)}. ` +
          `Last error: ${lastError?.message || 'unknown'}`
      )
    );
  }
}

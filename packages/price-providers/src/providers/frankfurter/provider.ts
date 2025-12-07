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

import type { Currency } from '@exitbook/core';
import { parseDecimal, wrapError } from '@exitbook/core';
import type { HttpClient } from '@exitbook/http';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { BasePriceProvider } from '../../core/base-provider.js';
import type { ProviderRateLimitConfig } from '../../core/utils.js';
import { createProviderHttpClient } from '../../core/utils.js';
import type { ProviderMetadata, PriceQuery, PriceData } from '../../index.js';
import type { PricesDB } from '../../persistence/database.js';
import { PriceRepository } from '../../persistence/repositories/price-repository.js';

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
export function createFrankfurterProvider(db: PricesDB): Result<FrankfurterProvider, Error> {
  try {
    // Frankfurter API base URL (v1 API)
    const baseUrl = 'https://api.frankfurter.dev/v1';

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl,
      providerName: 'Frankfurter',
      rateLimit: FRANKFURTER_RATE_LIMIT,
    });

    // Create repository
    const priceRepo = new PriceRepository(db);

    // Create provider
    const provider = new FrankfurterProvider(httpClient, priceRepo);

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
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient, priceRepo: PriceRepository) {
    super();

    this.httpClient = httpClient;
    this.priceRepo = priceRepo;

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
      const { asset, currency, timestamp } = query;

      // Validate: asset must be a supported fiat currency
      if (!asset.isFiat() || !isSupportedCurrency(asset.toString())) {
        return err(
          new Error(
            `Frankfurter only supports fiat currencies: ${FRANKFURTER_SUPPORTED_CURRENCIES.join(', ')}, got ${asset.toString()}`
          )
        );
      }

      // Validate: currency must be USD
      if (currency.toString() !== 'USD') {
        return err(new Error(`Frankfurter provider only supports USD as target currency, got ${currency.toString()}`));
      }

      // Special case: USD to USD
      if (asset.toString() === 'USD') {
        return ok({
          asset,
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
      const priceData = await this.fetchFromApi(asset, timestamp, currency);
      if (priceData.isErr()) {
        return err(priceData.error);
      }

      // 3. Cache the result using shared helper
      await this.saveToCache(priceData.value, `${asset.toString()}_USD`);

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
  private async fetchFromApi(asset: Currency, timestamp: Date, currency: Currency): Promise<Result<PriceData, Error>> {
    const maxAttempts = 7; // Try up to a week back
    let attemptDate = new Date(timestamp);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const dateStr = formatFrankfurterDate(attemptDate);

      // Build query parameters
      const params = new URLSearchParams({
        from: asset.toString(),
        to: currency.toString(),
      });

      const isOriginalDate = attempt === 0;
      this.logger.debug(
        {
          asset: asset.toString(),
          currency: currency.toString(),
          requestedDate: formatFrankfurterDate(timestamp),
          attemptDate: dateStr,
          attempt: attempt + 1,
        },
        isOriginalDate ? 'Fetching Frankfurter FX rate' : 'Retrying Frankfurter FX rate with earlier date'
      );

      // Make API request: GET /{date}?from={asset}&to={currency}
      const httpResult = await this.httpClient.get<unknown>(`/${dateStr}?${params.toString()}`);

      if (httpResult.isErr()) {
        lastError = httpResult.error;
        // For HTTP errors, try earlier date (might be weekend/holiday)
        // unless it's a 4xx error (client error - likely invalid currency)
        const errorMsg = httpResult.error.message;
        if (errorMsg.includes('400') || errorMsg.includes('404')) {
          // Client error - don't retry
          return err(httpResult.error);
        }
        // Server error or network issue - try earlier date
        attemptDate = new Date(attemptDate.getTime() - 24 * 60 * 60 * 1000);
        continue;
      }

      const rawResponse = httpResult.value;

      // Validate response schema
      const parseResult = FrankfurterSingleDateResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid Frankfurter response: ${parseResult.error.message}`));
      }

      // Transform response to PriceData
      const now = new Date();
      const priceDataResult = transformFrankfurterResponse(parseResult.data, asset, currency, attemptDate, now);

      if (priceDataResult.isOk()) {
        // Successfully found a rate
        const priceData = priceDataResult.value;

        // If we had to use a different date, log it
        if (!isOriginalDate) {
          this.logger.info(
            {
              asset: asset.toString(),
              requestedDate: formatFrankfurterDate(timestamp),
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
        `No FX rate found for ${asset.toString()} within ${maxAttempts} days of ${formatFrankfurterDate(timestamp)}. ` +
          `Last error: ${lastError?.message || 'unknown'}`
      )
    );
  }
}

/**
 * Bank of Canada FX rate provider implementation
 *
 * Provides CAD/USD exchange rates from Bank of Canada's Valet API
 * API Documentation: https://www.bankofcanada.ca/valet/docs
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
export function createBankOfCanadaProvider(db: PricesDB): Result<BankOfCanadaProvider, Error> {
  try {
    // Bank of Canada Valet API base URL
    const baseUrl = 'https://www.bankofcanada.ca/valet';

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl,
      providerName: 'BankOfCanada',
      rateLimit: BOC_RATE_LIMIT,
    });

    // Create repository
    const priceRepo = new PriceRepository(db);

    // Create provider
    const provider = new BankOfCanadaProvider(httpClient, priceRepo);

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
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient, priceRepo: PriceRepository) {
    super();

    this.httpClient = httpClient;
    this.priceRepo = priceRepo;

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
      const { asset, currency, timestamp } = query;

      // Validate: asset must be CAD
      if (!asset.isFiat() || asset.toString() !== 'CAD') {
        return err(new Error(`Bank of Canada only supports CAD currency, got ${asset.toString()}`));
      }

      // Validate: currency must be USD
      if (currency.toString() !== 'USD') {
        return err(new Error(`Bank of Canada only supports USD as target currency, got ${currency.toString()}`));
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
  private async fetchFromApi(asset: Currency, timestamp: Date, currency: Currency): Promise<Result<PriceData, Error>> {
    const maxAttempts = 7; // Try up to a week back
    let attemptDate = new Date(timestamp);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const dateStr = formatBoCDate(attemptDate);

      // Build query parameters
      const params = new URLSearchParams({
        start_date: dateStr,
        end_date: dateStr,
      });

      const isOriginalDate = attempt === 0;
      this.logger.debug(
        {
          asset: asset.toString(),
          currency: currency.toString(),
          requestedDate: formatBoCDate(timestamp),
          attemptDate: dateStr,
          attempt: attempt + 1,
        },
        isOriginalDate ? 'Fetching BoC FX rate' : 'Retrying BoC FX rate with earlier date'
      );

      // Make API request
      // Full endpoint: https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2024-01-01&end_date=2024-01-01
      // Note: BoC provides USD/CAD (how many CAD per USD), we convert to CAD/USD (how many USD per CAD)
      const httpResult = await this.httpClient.get<unknown>(`/observations/FXUSDCAD/json?${params.toString()}`);

      if (httpResult.isErr()) {
        // For HTTP errors, don't retry - fail immediately
        return err(httpResult.error);
      }

      const rawResponse = httpResult.value;

      // Validate response schema
      const parseResult = BankOfCanadaResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid Bank of Canada response: ${parseResult.error.message}`));
      }

      // Transform response to PriceData
      const now = new Date();
      const priceDataResult = transformBoCResponse(parseResult.data, asset, attemptDate, currency, now);

      if (priceDataResult.isOk()) {
        // Successfully found a rate
        const priceData = priceDataResult.value;

        // If we had to use a different date, update granularity and log
        if (!isOriginalDate) {
          this.logger.info(
            {
              asset: asset.toString(),
              requestedDate: formatBoCDate(timestamp),
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
        `No FX rate found for ${asset.toString()} within ${maxAttempts} days of ${formatBoCDate(timestamp)}. ` +
          `Last error: ${lastError?.message || 'unknown'}`
      )
    );
  }
}

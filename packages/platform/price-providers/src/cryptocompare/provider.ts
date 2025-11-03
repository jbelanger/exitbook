/**
 * CryptoCompare price provider implementation
 */

import type { Currency } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { HttpClient } from '@exitbook/platform-http';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesDB } from '../persistence/database.ts';
import { PriceRepository } from '../persistence/repositories/price-repository.js';
import { BasePriceProvider } from '../shared/base-provider.js';
import { CoinNotFoundError } from '../shared/errors.js';
import { createProviderHttpClient, type ProviderRateLimitConfig } from '../shared/shared-utils.js';
import type { PriceData, PriceQuery, ProviderMetadata } from '../shared/types/index.js';

import {
  buildHistoricalParams,
  buildPriceParams,
  canUseCurrentPrice,
  getHistoricalGranularity,
  transformHistoricalResponse,
  transformPriceResponse,
} from './cryptocompare-utils.js';
import { CryptoCompareHistoricalResponseSchema, CryptoComparePriceResponseSchema } from './schemas.js';

/**
 * CryptoCompare API rate limits by tier
 * Based on official API documentation
 */
const CRYPTOCOMPARE_RATE_LIMITS = {
  /** Free tier (no API key): ~100,000 calls/month (~139 calls/hour) */
  free: {
    burstLimit: 5,
    requestsPerHour: 139, // ~100k per month
    requestsPerMinute: 2,
    requestsPerSecond: 0.04, // Very conservative for monthly limit
  } satisfies ProviderRateLimitConfig,

  /** Paid tier (API key): Higher limits depending on plan */
  paid: {
    burstLimit: 20,
    requestsPerHour: 1000, // Conservative estimate for paid plans
    requestsPerMinute: 16,
    requestsPerSecond: 0.27,
  } satisfies ProviderRateLimitConfig,
} as const;

/**
 * Configuration for CryptoCompare provider factory
 */
export interface CryptoCompareProviderConfig {
  /** API key for CryptoCompare (optional - uses free tier if not provided) */
  apiKey?: string | undefined;
}

/**
 * Create a fully configured CryptoCompare provider
 *
 * @param db - Initialized prices database instance
 * @param config - Provider configuration (API key)
 */
export function createCryptoCompareProvider(
  db: PricesDB,
  config: CryptoCompareProviderConfig = {}
): Result<CryptoCompareProvider, Error> {
  try {
    // Read from environment if not provided in config
    const apiKey = config.apiKey ?? process.env.CRYPTOCOMPARE_API_KEY;

    // Determine rate limits based on whether API key is provided
    const rateLimit = apiKey ? CRYPTOCOMPARE_RATE_LIMITS.paid : CRYPTOCOMPARE_RATE_LIMITS.free;

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl: 'https://min-api.cryptocompare.com',
      providerName: 'CryptoCompare',
      rateLimit,
      // CryptoCompare uses query param for API key, not header
    });

    // Create repository
    const priceRepo = new PriceRepository(db);

    // Create provider
    const provider = new CryptoCompareProvider(httpClient, priceRepo, { apiKey }, rateLimit);

    return ok(provider);
  } catch (error) {
    return err(
      new Error(`Failed to create CryptoCompare provider: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * CryptoCompare price provider
 * Free tier: ~100,000 calls/month
 *
 * Imperative shell managing HTTP client, DB repositories, and orchestration
 * Uses pure functions from cryptocompare-utils.ts for all transformations
 */
export class CryptoCompareProvider extends BasePriceProvider {
  protected metadata: ProviderMetadata;
  private readonly httpClient: HttpClient;
  private readonly config: CryptoCompareProviderConfig;

  constructor(
    httpClient: HttpClient,
    priceRepo: PriceRepository,
    config: CryptoCompareProviderConfig = {},
    rateLimit: ProviderRateLimitConfig
  ) {
    super();

    this.httpClient = httpClient;
    this.priceRepo = priceRepo;
    this.config = config;

    // Provider metadata
    this.metadata = {
      capabilities: {
        supportedAssetTypes: ['crypto'],
        supportedAssets: undefined, // Supports thousands of cryptocurrencies
        supportedOperations: ['fetchPrice'],
        rateLimit: {
          burstLimit: rateLimit.burstLimit,
          requestsPerHour: rateLimit.requestsPerHour,
          requestsPerMinute: rateLimit.requestsPerMinute,
          requestsPerSecond: rateLimit.requestsPerSecond,
        },
        granularitySupport: [
          {
            granularity: 'minute',
            maxHistoryDays: 7,
            limitation: 'Free tier - 7 days of minute data',
          },
          {
            granularity: 'hour',
            maxHistoryDays: 90,
            limitation: 'Free tier - 90 days of hourly data',
          },
          {
            granularity: 'day',
            maxHistoryDays: undefined, // Unlimited
          },
        ],
      },
      displayName: 'CryptoCompare',
      name: 'cryptocompare',
      requiresApiKey: false,
    };
  }

  /**
   * Fetch single price (implements BasePriceProvider)
   * Query is already validated and currency is normalized by BasePriceProvider
   */
  protected async fetchPriceInternal(query: PriceQuery): Promise<Result<PriceData, Error>> {
    try {
      // Currency is guaranteed to be set by BasePriceProvider
      const currency = query.currency;

      // 1. Check cache using shared helper
      const cachedResult = await this.checkCache(query, currency);
      if (cachedResult.isErr()) {
        return err(cachedResult.error);
      }
      if (cachedResult.value) {
        return ok(cachedResult.value);
      }

      // 2. Fetch from API
      const priceData = await this.fetchFromApi(query.asset, query.timestamp, currency);
      if (priceData.isErr()) {
        return err(priceData.error);
      }

      // 3. Cache the result using shared helper (use asset symbol as "coin ID" for CryptoCompare)
      await this.saveToCache(priceData.value, query.asset.toString());

      return ok(priceData.value);
    } catch (error) {
      return wrapError(error, 'Failed to fetch price');
    }
  }

  /**
   * Fetch price from CryptoCompare API (current or historical)
   */
  private async fetchFromApi(asset: Currency, timestamp: Date, currency: Currency): Promise<Result<PriceData, Error>> {
    const now = new Date();

    // Use current price API for very recent data
    if (canUseCurrentPrice(timestamp)) {
      this.logger.debug({ asset: asset.toString() }, 'Using current price API');

      const params = buildPriceParams(asset, currency, this.config.apiKey);
      const searchParams = new URLSearchParams(params);

      const httpResult = await this.httpClient.get<unknown>(`/data/price?${searchParams.toString()}`);
      if (httpResult.isErr()) {
        return err(httpResult.error);
      }
      const rawResponse = httpResult.value;

      const parseResult = CryptoComparePriceResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid price response: ${parseResult.error.message}`));
      }

      // Transform
      const priceDataResult = transformPriceResponse(parseResult.data, asset, timestamp, currency, now);
      if (priceDataResult.isErr()) {
        return err(priceDataResult.error);
      }
      return ok(priceDataResult.value);
    }

    // Use historical API for older data
    this.logger.debug({ asset: asset.toString(), timestamp }, 'Using historical price API');

    const granularity = getHistoricalGranularity(timestamp);
    const endpoint = `/data/v2/histo${granularity}`;

    const params = buildHistoricalParams(asset, currency, timestamp, this.config.apiKey);
    const searchParams = new URLSearchParams(params);

    const httpResult = await this.httpClient.get<unknown>(`${endpoint}?${searchParams.toString()}`);
    if (httpResult.isErr()) {
      return err(httpResult.error);
    }
    const rawResponse = httpResult.value;

    const parseResult = CryptoCompareHistoricalResponseSchema.safeParse(rawResponse);
    if (!parseResult.success) {
      return err(new Error(`Invalid historical price response: ${parseResult.error.message}`));
    }

    // Check for CryptoCompare-specific "market does not exist" error
    // Example: "CCCAGG market does not exist for this coin pair (CFG-USD)"
    //
    // NOTE: This uses string matching because CryptoCompare returns 200 OK with error messages
    // in the response body rather than using HTTP status codes. If CryptoCompare changes their
    // error message format, this detection will break. This is a known limitation of their API.
    if (parseResult.data.Response !== 'Success') {
      const errorMessage = parseResult.data.Message || 'Unknown error';

      if (errorMessage.includes('market does not exist')) {
        return err(
          new CoinNotFoundError(
            `CryptoCompare does not have data for ${asset.toString()}: ${errorMessage}`,
            asset.toString(),
            'cryptocompare',
            { currency: currency.toString() }
          )
        );
      }

      // Other API errors (rate limit, etc)
      return err(new Error(`CryptoCompare API error: ${errorMessage}`));
    }

    // Transform
    const priceDataResult = transformHistoricalResponse(parseResult.data, asset, timestamp, currency, now, granularity);
    if (priceDataResult.isErr()) {
      return err(priceDataResult.error);
    }
    return ok(priceDataResult.value);
  }
}

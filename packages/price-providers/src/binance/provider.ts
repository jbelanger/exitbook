/**
 * Binance price provider implementation
 */

import type { Currency } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { HttpClient } from '@exitbook/http';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesDB } from '../persistence/database.js';
import { PriceRepository } from '../persistence/repositories/price-repository.js';
import { BasePriceProvider } from '../shared/base-provider.js';
import { CoinNotFoundError } from '../shared/errors.js';
import { createProviderHttpClient, type ProviderRateLimitConfig } from '../shared/shared-utils.js';
import type { PriceData, PriceQuery, ProviderMetadata } from '../shared/types/index.js';

import {
  buildBinanceKlinesParams,
  buildBinanceSymbol,
  isBinanceCoinNotFoundError,
  mapCurrencyToBinanceQuote,
  selectBinanceInterval,
  transformBinanceKlineResponse,
} from './binance-utils.js';
import { BinanceErrorResponseSchema, BinanceKlinesResponseSchema } from './schemas.js';

/**
 * Binance API rate limits
 * Based on official documentation: https://binance-docs.github.io/apidocs/spot/en/#limits
 */
const BINANCE_RATE_LIMITS = {
  /** Free public API - no authentication required */
  free: {
    burstLimit: 50, // Can burst up to 50 requests
    requestsPerHour: 6000, // 6000 weight per hour
    requestsPerMinute: 1200, // 1200 weight per minute
    requestsPerSecond: 20, // 20 weight per second
  } satisfies ProviderRateLimitConfig,
} as const;

/**
 * Configuration for Binance provider factory
 * Currently empty - Binance public API doesn't require API key
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Empty interface for future extensibility (authenticated API support)
export interface BinanceProviderConfig {
  // Future: Could add support for authenticated API with higher limits
}

/**
 * Create a fully configured Binance provider
 *
 * @param db - Initialized prices database instance
 * @param config - Provider configuration (currently empty - no API key needed)
 */
export function createBinanceProvider(
  db: PricesDB,
  config: BinanceProviderConfig = {}
): Result<BinanceProvider, Error> {
  try {
    const rateLimit = BINANCE_RATE_LIMITS.free;

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl: 'https://api.binance.com',
      providerName: 'Binance',
      rateLimit,
    });

    // Create repository
    const priceRepo = new PriceRepository(db);

    // Create provider
    const provider = new BinanceProvider(httpClient, priceRepo, config, rateLimit);

    return ok(provider);
  } catch (error) {
    return err(
      new Error(`Failed to create Binance provider: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Binance price provider
 * Free tier: ~6000 calls/hour
 *
 * Provides minute-level historical data for ~1 year
 * Falls back to daily data for older timestamps
 *
 * Imperative shell managing HTTP client, DB repositories, and orchestration
 * Uses pure functions from binance-utils.js for all transformations
 */
export class BinanceProvider extends BasePriceProvider {
  protected metadata: ProviderMetadata;
  private readonly httpClient: HttpClient;
  private readonly config: BinanceProviderConfig;

  constructor(
    httpClient: HttpClient,
    priceRepo: PriceRepository,
    _config: BinanceProviderConfig = {},
    rateLimit: ProviderRateLimitConfig
  ) {
    super();

    this.httpClient = httpClient;
    this.priceRepo = priceRepo;
    this.config = _config;

    // Provider metadata
    this.metadata = {
      capabilities: {
        supportedAssetTypes: ['crypto'],
        supportedAssets: undefined, // Discovers pairs via API (thousands of trading pairs)
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
            maxHistoryDays: 365,
            limitation: 'Binance provides ~1 year of minute data',
          },
          {
            granularity: 'day',
            maxHistoryDays: undefined, // Unlimited
          },
        ],
      },
      displayName: 'Binance',
      name: 'binance',
      requiresApiKey: false, // Public API, no auth needed
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

      // 3. Cache the result using shared helper (use asset symbol as identifier)
      await this.saveToCache(priceData.value, query.asset.toString());

      return ok(priceData.value);
    } catch (error) {
      return wrapError(error, 'Failed to fetch price');
    }
  }

  /**
   * Fetch price from Binance API
   *
   * Tries multiple quote assets (USDT, BUSD, USD) if initial request fails
   */
  private async fetchFromApi(asset: Currency, timestamp: Date, currency: Currency): Promise<Result<PriceData, Error>> {
    const now = new Date();

    // Determine interval and granularity based on timestamp age
    const { interval, granularity } = selectBinanceInterval(timestamp);
    this.logger.debug({ asset: asset.toString(), interval, granularity }, 'Selected Binance interval');

    // Get possible quote assets for the target currency
    const quoteAssets = mapCurrencyToBinanceQuote(currency);

    // Try each quote asset until one succeeds
    let lastError: Error | undefined;
    const attemptedSymbols: string[] = [];

    for (const quoteAsset of quoteAssets) {
      const symbol = buildBinanceSymbol(asset, quoteAsset);
      attemptedSymbols.push(symbol);
      this.logger.debug({ symbol, quoteAsset }, 'Trying Binance symbol');

      const result = await this.fetchKline(symbol, interval, timestamp, asset, currency, granularity, now);

      if (result.isOk()) {
        return ok(result.value);
      }

      // If it's a coin not found error, try next quote asset
      if (result.error instanceof CoinNotFoundError) {
        lastError = result.error;
        continue;
      }

      // For other errors (rate limit, network, etc.), fail immediately
      return err(result.error);
    }

    // If all quote assets failed, return consolidated error message
    if (lastError) {
      return err(
        new CoinNotFoundError(
          `Binance does not have data for ${asset.toString()} (tried: ${attemptedSymbols.join(', ')})`,
          asset.toString(),
          'binance',
          { currency: currency.toString() }
        )
      );
    }

    return err(new Error(`Failed to fetch price for ${asset.toString()}`));
  }

  /**
   * Fetch a single kline from Binance
   */
  private async fetchKline(
    symbol: string,
    interval: string,
    timestamp: Date,
    asset: Currency,
    currency: Currency,
    granularity: 'minute' | 'hour' | 'day',
    now: Date
  ): Promise<Result<PriceData, Error>> {
    // Build query params
    const params = buildBinanceKlinesParams(symbol, interval, timestamp);
    const searchParams = new URLSearchParams(params);

    // Fetch from API
    const httpResult = await this.httpClient.get<unknown>(`/api/v3/klines?${searchParams.toString()}`);
    if (httpResult.isErr()) {
      // Check if error message contains Binance error response
      // HTTP client returns errors as: "HTTP 400: {json body}"
      const errorMatch = httpResult.error.message.match(/HTTP \d+: (\{.+\})/);
      if (errorMatch && errorMatch[1]) {
        try {
          const parsedError = JSON.parse(errorMatch[1]) as unknown;
          const errorParse = BinanceErrorResponseSchema.safeParse(parsedError);
          if (errorParse.success) {
            const errorCode = errorParse.data.code;
            const errorMsg = errorParse.data.msg;

            // Check for specific error types
            if (isBinanceCoinNotFoundError(errorCode)) {
              return err(
                new CoinNotFoundError(
                  `Binance does not have data for ${asset.toString()} with symbol ${symbol}: ${errorMsg}`,
                  asset.toString(),
                  'binance',
                  { currency: currency.toString() }
                )
              );
            }

            return err(new Error(`Binance API error (${errorCode}): ${errorMsg}`));
          }
        } catch {
          // If parsing fails, fall through to return original error
        }
      }

      return err(httpResult.error);
    }
    const rawResponse = httpResult.value;

    // Check if response is an error
    const errorParse = BinanceErrorResponseSchema.safeParse(rawResponse);
    if (errorParse.success) {
      const errorCode = errorParse.data.code;
      const errorMsg = errorParse.data.msg;

      // Check for specific error types
      if (isBinanceCoinNotFoundError(errorCode)) {
        return err(
          new CoinNotFoundError(
            `Binance does not have data for ${asset.toString()} with symbol ${symbol}: ${errorMsg}`,
            asset.toString(),
            'binance',
            { currency: currency.toString() }
          )
        );
      }

      return err(new Error(`Binance API error (${errorCode}): ${errorMsg}`));
    }

    // Parse as klines response
    const parseResult = BinanceKlinesResponseSchema.safeParse(rawResponse);
    if (!parseResult.success) {
      return err(new Error(`Invalid Binance klines response: ${parseResult.error.message}`));
    }

    const klines = parseResult.data;

    // Check if we got data
    if (klines.length === 0) {
      return err(
        new CoinNotFoundError(
          `Binance returned no data for ${asset.toString()} with symbol ${symbol}`,
          asset.toString(),
          'binance',
          { currency: currency.toString() }
        )
      );
    }

    // Transform
    const priceDataResult = transformBinanceKlineResponse(klines[0]!, asset, timestamp, currency, now, granularity);
    if (priceDataResult.isErr()) {
      return err(priceDataResult.error);
    }

    return ok(priceDataResult.value);
  }
}

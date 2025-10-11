/**
 * CryptoCompare price provider implementation
 */

import { Currency, getErrorMessage, wrapError } from '@exitbook/core';
import { HttpClient } from '@exitbook/platform-http';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesDB } from '../pricing/database.ts';
import { PriceRepository } from '../pricing/repositories/price-repository.js';
import { BasePriceProvider } from '../shared/base-provider.js';
import type { PriceData, PriceQuery, ProviderMetadata } from '../shared/types/index.js';

import {
  buildHistoricalParams,
  buildPriceMultiParams,
  buildPriceParams,
  canUseCurrentPrice,
  getHistoricalGranularity,
  transformHistoricalResponse,
  transformPriceMultiResponse,
  transformPriceResponse,
} from './cryptocompare-utils.js';
import {
  CryptoCompareHistoricalResponseSchema,
  CryptoComparePriceMultiResponseSchema,
  CryptoComparePriceResponseSchema,
} from './schemas.js';

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
 * This factory handles:
 * - Repository creation
 * - HTTP client configuration
 * - Provider instantiation
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

    // Create HTTP client with CryptoCompare-specific configuration
    const httpClient = new HttpClient({
      baseUrl: 'https://min-api.cryptocompare.com',
      defaultHeaders: {
        Accept: 'application/json',
      },
      providerName: 'CryptoCompare',
      rateLimit: {
        // Free tier: ~100,000 calls/month (~3,333 per day)
        // With API key: varies by plan
        burstLimit: apiKey ? 10 : 3,
        requestsPerHour: apiKey ? 500 : 138, // Conservative for free tier (~3,333/day)
        requestsPerMinute: apiKey ? 50 : 10,
        requestsPerSecond: apiKey ? 1.0 : 0.2,
      },
      retries: 3,
      timeout: 10000,
    });

    // Create repositories
    const priceRepo = new PriceRepository(db);

    // Create provider config
    const providerConfig: CryptoCompareProviderConfig = {
      apiKey,
    };

    // Instantiate provider
    const provider = new CryptoCompareProvider(httpClient, priceRepo, providerConfig);

    return ok(provider);
  } catch (error) {
    const message = getErrorMessage(error);
    return err(new Error(`Failed to create CryptoCompare provider: ${message}`));
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
  private readonly logger = getLogger('CryptoCompareProvider');
  private readonly httpClient: HttpClient;
  private readonly priceRepo: PriceRepository;
  private readonly config: CryptoCompareProviderConfig;

  constructor(httpClient: HttpClient, priceRepo: PriceRepository, config: CryptoCompareProviderConfig = {}) {
    super();

    this.httpClient = httpClient;
    this.priceRepo = priceRepo;
    this.config = config;

    // Provider metadata
    this.metadata = {
      capabilities: {
        maxBatchSize: 50,
        supportedCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOT', 'MATIC'],
        supportedOperations: ['fetchPrice', 'fetchBatch'],
      },
      displayName: 'CryptoCompare',
      name: 'cryptocompare',
      priority: 2, // Lower priority than CoinGecko by default
      requiresApiKey: false,
    };
  }

  /**
   * Optimized batch fetching
   */
  async fetchBatch(queries: PriceQuery[]): Promise<Result<PriceData[], Error>> {
    try {
      this.logger.info(
        {
          queryCount: queries.length,
          queries: queries.map((q) => ({
            asset: q.asset.toString(),
            currency: q.currency?.toString() || 'USD',
            timestamp: q.timestamp.toISOString(),
          })),
        },
        'fetchBatch called'
      );

      // Group queries by whether they can use current price API
      const recentQueries = queries.filter((q) => canUseCurrentPrice(q.timestamp));
      const historicalQueries = queries.filter((q) => !canUseCurrentPrice(q.timestamp));

      this.logger.info(
        { recentCount: recentQueries.length, historicalCount: historicalQueries.length },
        'Queries grouped'
      );

      const results: PriceData[] = [];

      // Fetch recent prices in batch
      if (recentQueries.length > 0) {
        this.logger.info(`Fetching ${recentQueries.length} recent prices via batch API`);
        const batchResult = await this.fetchBatchCurrentPrice(recentQueries);
        if (batchResult.isOk()) {
          results.push(...batchResult.value);
          this.logger.info(`Batch API returned ${batchResult.value.length} prices`);
        } else {
          this.logger.error({ error: batchResult.error.message }, 'Batch API failed');
        }
      }

      // Fetch historical prices individually (can't batch efficiently)
      for (const query of historicalQueries) {
        const result = await this.fetchPrice(query);
        if (result.isOk()) {
          results.push(result.value);
        }
      }

      if (results.length === 0) {
        return err(new Error('All batch queries failed'));
      }

      return ok(results);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new Error(`Batch fetch failed: ${message}`));
    }
  }

  /**
   * Fetch single price (implements BasePriceProvider)
   */
  protected async fetchPriceImpl(query: PriceQuery): Promise<Result<PriceData, Error>> {
    try {
      const currency = query.currency || Currency.create('USD');

      // 1. Check cache first
      const cachedResult = await this.priceRepo.getPrice(query.asset, currency, query.timestamp);

      if (cachedResult.isErr()) {
        return err(cachedResult.error);
      }

      if (cachedResult.value) {
        this.logger.debug(
          { asset: query.asset, currency: query.currency, timestamp: query.timestamp },
          'Price found in cache'
        );
        return ok(cachedResult.value);
      }

      // 2. Fetch from API
      const priceData = await this.fetchFromApi(query.asset, query.timestamp, currency);
      if (priceData.isErr()) {
        return err(priceData.error);
      }

      // 3. Cache the result (use asset symbol as "coin ID" for CryptoCompare)
      const cacheResult = await this.priceRepo.savePrice(priceData.value, query.asset.toString());
      if (cacheResult.isErr()) {
        this.logger.warn({ error: cacheResult.error }, 'Failed to cache price');
        // Don't fail the request if caching fails
      }

      return ok(priceData.value);
    } catch (error) {
      return wrapError(error, 'Failed to fetch price');
    }
  }

  /**
   * Fetch price from CryptoCompare API (current or historical)
   */
  private async fetchFromApi(asset: Currency, timestamp: Date, currency: Currency): Promise<Result<PriceData, Error>> {
    try {
      const now = new Date();

      // Use current price API for very recent data
      if (canUseCurrentPrice(timestamp)) {
        this.logger.debug({ asset: asset.toString() }, 'Using current price API');

        const params = buildPriceParams(asset, currency, this.config.apiKey);
        const searchParams = new URLSearchParams(params);

        const rawResponse = await this.httpClient.get<unknown>(`/data/price?${searchParams.toString()}`);

        const parseResult = CryptoComparePriceResponseSchema.safeParse(rawResponse);
        if (!parseResult.success) {
          return err(new Error(`Invalid price response: ${parseResult.error.message}`));
        }

        // Transform using pure function
        const priceData = transformPriceResponse(parseResult.data, asset, timestamp, currency, now);
        return ok(priceData);
      }

      // Use historical API for older data
      this.logger.debug({ asset: asset.toString(), timestamp }, 'Using historical price API');

      const granularity = getHistoricalGranularity(timestamp);
      const endpoint = `/data/v2/histo${granularity}`;

      const params = buildHistoricalParams(asset, currency, timestamp, this.config.apiKey);
      const searchParams = new URLSearchParams(params);

      const rawResponse = await this.httpClient.get<unknown>(`${endpoint}?${searchParams.toString()}`);

      const parseResult = CryptoCompareHistoricalResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid historical price response: ${parseResult.error.message}`));
      }

      // Transform using pure function
      const priceData = transformHistoricalResponse(parseResult.data, asset, timestamp, currency, now);
      return ok(priceData);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new Error(`API fetch failed: ${message}`));
    }
  }

  /**
   * Fetch multiple prices using pricemulti API (batch current prices)
   */
  private async fetchBatchCurrentPrice(queries: PriceQuery[]): Promise<Result<PriceData[], Error>> {
    try {
      // Extract unique assets
      const assets = [...new Set(queries.map((q) => q.asset))];
      const currency = queries[0]?.currency || Currency.create('USD');

      // Build params using pure function
      const params = buildPriceMultiParams(assets, currency, this.config.apiKey);
      const searchParams = new URLSearchParams(params);

      // Fetch batch
      const rawResponse = await this.httpClient.get<unknown>(`/data/pricemulti?${searchParams.toString()}`);

      const parseResult = CryptoComparePriceMultiResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid price multi response: ${parseResult.error.message}`));
      }

      // Transform responses
      const now = new Date();
      const results: PriceData[] = [];

      for (const query of queries) {
        try {
          const priceData = transformPriceMultiResponse(parseResult.data, query.asset, query.timestamp, currency, now);
          results.push(priceData);

          // Cache the result
          await this.priceRepo.savePrice(priceData, query.asset.toString());
        } catch (error) {
          this.logger.warn({ error, asset: query.asset.toString() }, 'Failed to transform price for asset');
        }
      }

      return ok(results);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new Error(`Batch current price fetch failed: ${message}`));
    }
  }
}

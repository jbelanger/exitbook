/**
 * CoinGecko price provider implementation
 */

import { Currency, getErrorMessage, wrapError } from '@exitbook/core';
import type { HttpClient } from '@exitbook/platform-http';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesDB } from '../persistence/database.ts';
import { PriceRepository } from '../persistence/repositories/price-repository.js';
import { ProviderRepository } from '../persistence/repositories/provider-repository.js';
import { BasePriceProvider } from '../shared/base-provider.js';
import { CoinNotFoundError } from '../shared/errors.js';
import { createProviderHttpClient, type ProviderRateLimitConfig } from '../shared/shared-utils.js';
import type { PriceData, PriceQuery, ProviderMetadata } from '../shared/types/index.js';

import {
  canUseSimplePrice,
  formatCoinGeckoDate,
  transformHistoricalResponse,
  transformSimplePriceResponse,
} from './coingecko-utils.js';
import {
  CoinGeckoHistoricalPriceResponseSchema,
  CoinGeckoMarketsSchema,
  CoinGeckoSimplePriceResponseSchema,
} from './schemas.js';

/**
 * CoinGecko API rate limits by tier
 * Based on official API documentation
 */
const COINGECKO_RATE_LIMITS = {
  /** Free tier (no API key): 10-50 calls/minute */
  free: {
    burstLimit: 1,
    requestsPerHour: 600, // 10 req/min conservative
    requestsPerMinute: 10,
    requestsPerSecond: 0.17, // ~10 per minute
  } satisfies ProviderRateLimitConfig,

  /** Demo tier (API key, non-Pro): 30 calls/minute */
  demo: {
    burstLimit: 5,
    requestsPerHour: 1800, // 30 req/min
    requestsPerMinute: 30,
    requestsPerSecond: 0.5,
  } satisfies ProviderRateLimitConfig,

  /** Pro tier (Pro API key): 500 calls/minute */
  pro: {
    burstLimit: 50,
    requestsPerHour: 30000, // 500 req/min
    requestsPerMinute: 500,
    requestsPerSecond: 8.33,
  } satisfies ProviderRateLimitConfig,
} as const;

/**
 * Configuration for CoinGecko provider factory
 */
export interface CoinGeckoProviderConfig {
  /** API key for CoinGecko (optional - uses free tier if not provided) */
  apiKey?: string | undefined;
  /** Use Pro API endpoint (requires API key) */
  useProApi?: boolean | undefined;
}

/**
 * Create a fully configured CoinGecko provider
 *
 * @param db - Initialized prices database instance
 * @param config - Provider configuration (API key, Pro API flag)
 */
export function createCoinGeckoProvider(
  db: PricesDB,
  config: CoinGeckoProviderConfig = {}
): Result<CoinGeckoProvider, Error> {
  try {
    // Read from environment if not provided in config
    const apiKey = config.apiKey ?? process.env.COINGECKO_API_KEY;
    const useProApi = config.useProApi ?? process.env.COINGECKO_USE_PRO_API === 'true';

    // Determine base URL based on API type
    const baseUrl = useProApi ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';

    // Determine rate limits based on tier
    const rateLimit = useProApi
      ? COINGECKO_RATE_LIMITS.pro // Pro API with API key
      : apiKey
        ? COINGECKO_RATE_LIMITS.demo // Standard API with API key
        : COINGECKO_RATE_LIMITS.free; // No API key (free tier)

    // Create HTTP client
    const httpClient = createProviderHttpClient({
      baseUrl,
      providerName: 'CoinGecko',
      apiKey,
      apiKeyHeader: 'x-cg-demo-api-key',
      rateLimit,
    });

    // Create repositories
    const priceRepo = new PriceRepository(db);
    const providerRepo = new ProviderRepository(db);

    // Create provider
    const provider = new CoinGeckoProvider(httpClient, priceRepo, providerRepo, { apiKey, useProApi }, rateLimit);

    return ok(provider);
  } catch (error) {
    return err(
      new Error(`Failed to create CoinGecko provider: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * CoinGecko price provider
 * Free tier: 10-50 calls/minute
 *
 * Imperative shell managing HTTP client, DB repositories, and orchestration
 * Uses pure functions from coingecko-utils.ts for all transformations
 */
export class CoinGeckoProvider extends BasePriceProvider {
  protected metadata: ProviderMetadata;
  private readonly httpClient: HttpClient;
  private readonly providerRepo: ProviderRepository;
  private readonly config: CoinGeckoProviderConfig;

  // Cache provider ID after first lookup
  private providerIdCache: number | undefined;

  constructor(
    httpClient: HttpClient,
    priceRepo: PriceRepository,
    providerRepo: ProviderRepository,
    config: CoinGeckoProviderConfig = {},
    rateLimit: ProviderRateLimitConfig
  ) {
    super();

    this.httpClient = httpClient;
    this.priceRepo = priceRepo;
    this.providerRepo = providerRepo;
    this.config = config;

    // Provider metadata
    this.metadata = {
      capabilities: {
        supportedCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'],
        supportedOperations: ['fetchPrice'],
        rateLimit: {
          burstLimit: rateLimit.burstLimit,
          requestsPerHour: rateLimit.requestsPerHour,
          requestsPerMinute: rateLimit.requestsPerMinute,
          requestsPerSecond: rateLimit.requestsPerSecond,
        },
      },
      displayName: 'CoinGecko',
      name: 'coingecko',
      requiresApiKey: false,
    };
  }

  /**
   * Initialize provider (implements IPriceProvider lifecycle hook)
   * Syncs coin list on startup
   */
  async initialize(): Promise<Result<void, Error>> {
    const result = await this.syncCoinList();
    if (result.isErr()) {
      return err(result.error);
    }
    return ok();
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

      // 2. Ensure provider is registered and synced
      const providerIdResult = await this.ensureProviderRegistered();
      if (providerIdResult.isErr()) {
        return err(providerIdResult.error);
      }
      const providerId = providerIdResult.value;

      // 3. Get coin ID for symbol
      const coinIdResult = await this.providerRepo.getCoinIdForSymbol(providerId, query.asset);
      if (coinIdResult.isErr()) {
        return err(coinIdResult.error);
      }

      const coinId = coinIdResult.value;
      if (!coinId) {
        return err(
          new CoinNotFoundError(
            `No CoinGecko coin ID found for symbol: ${query.asset.toString()}. ` +
              `The asset may not be in the top 5000 coins by market cap, or the coin list may need to be synced.`,
            query.asset.toString(),
            'coingecko',
            {
              suggestion: 'Try deleting ./data/prices.db to force a fresh sync, or provide the price manually.',
              timestamp: query.timestamp,
              currency: query.currency.toString(),
            }
          )
        );
      }

      // 4. Fetch from API
      const priceData = await this.fetchFromApi(coinId, query.asset, query.timestamp, currency);
      if (priceData.isErr()) {
        return err(priceData.error);
      }

      // 5. Cache the result using shared helper
      await this.saveToCache(priceData.value, coinId);

      return ok(priceData.value);
    } catch (error) {
      return wrapError(error, 'Failed to fetch price');
    }
  }

  /**
   * Sync coin list from CoinGecko API
   *
   * Fetches top coins by market cap to ensure correct coin ID mapping
   * for symbols with multiple entries (e.g., BTC maps to Bitcoin, not batcat)
   */
  private async syncCoinList(): Promise<Result<number, Error>> {
    try {
      this.logger.info('Syncing coin list from CoinGecko');

      // 1. Ensure provider exists
      const providerIdResult = await this.ensureProviderRegistered();
      if (providerIdResult.isErr()) {
        return err(providerIdResult.error);
      }
      const providerId = providerIdResult.value;

      // 2. Check if sync is needed
      const needsSyncResult = await this.providerRepo.needsCoinListSync(providerId);
      if (needsSyncResult.isErr()) {
        return err(needsSyncResult.error);
      }

      if (!needsSyncResult.value) {
        this.logger.debug('Coin list is up to date, skipping sync');
        return ok(0);
      }

      // 3. Fetch top coins by market cap (this gives us the correct priorities)
      // Markets endpoint returns coins sorted by market cap
      this.logger.debug('Fetching top coins by market cap from CoinGecko API');
      const allMarketCoins = [];

      // Fetch multiple pages to get top coins by market cap
      // Fetch 20 pages (5000 coins) to cover most assets users will encounter
      // This uses about 20 API calls but only happens once per day
      const maxPages = 20;
      for (let page = 1; page <= maxPages; page++) {
        const params = new URLSearchParams({
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: '250',
          page: page.toString(),
          sparkline: 'false',
        });

        const rawMarketResponse = await this.httpClient.get<unknown>(`/coins/markets?${params.toString()}`, {
          headers: {
            'x-cg-demo-api-key': this.config.apiKey || '',
          },
        });

        const marketParseResult = CoinGeckoMarketsSchema.safeParse(rawMarketResponse);
        if (!marketParseResult.success) {
          this.logger.warn({ page, error: marketParseResult.error }, 'Failed to parse markets page');
          break; // Stop on error but keep what we have
        }

        allMarketCoins.push(...marketParseResult.data);

        // Log progress every 5 pages
        if (page % 5 === 0 || page === maxPages) {
          this.logger.info({ page, totalPages: maxPages, totalCoins: allMarketCoins.length }, 'Coin sync progress');
        }
      }

      this.logger.info({ count: allMarketCoins.length }, 'Market coins fetched successfully');

      // 4. Build mappings prioritizing by market cap rank
      const symbolMap = new Map<string, { coinId: string; marketCapRank: number; name: string }>();

      for (const coin of allMarketCoins) {
        const symbol = Currency.create(coin.symbol).toString();
        const marketCapRank = coin.market_cap_rank || 999999;

        // If symbol exists, keep the one with better (lower) market cap rank
        if (symbolMap.has(symbol)) {
          const existing = symbolMap.get(symbol)!;
          if (marketCapRank < existing.marketCapRank) {
            symbolMap.set(symbol, { coinId: coin.id, name: coin.name, marketCapRank });
          }
        } else {
          symbolMap.set(symbol, { coinId: coin.id, name: coin.name, marketCapRank });
        }
      }

      // 5. Convert Map to array for DB storage
      const mappings = Array.from(symbolMap.entries()).map(([symbol, data]) => ({
        coin_id: data.coinId,
        coin_name: data.name,
        symbol,
        priority: data.marketCapRank,
      }));

      // 6. Store mappings in DB
      const upsertResult = await this.providerRepo.upsertCoinMappings(providerId, mappings);
      if (upsertResult.isErr()) {
        return err(upsertResult.error);
      }

      // 7. Update sync timestamp
      const updateResult = await this.providerRepo.updateProviderSync(providerId, mappings.length);
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      this.logger.info({ count: mappings.length }, 'Coin list synced successfully');
      return ok(mappings.length);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new Error(`Coin list sync failed: ${message}`));
    }
  }

  /**
   * Ensure provider is registered in DB and return its ID
   */
  private async ensureProviderRegistered(): Promise<Result<number, Error>> {
    // Use cached ID if available
    if (this.providerIdCache !== undefined) {
      return ok(this.providerIdCache);
    }

    const result = await this.providerRepo.upsertProvider('coingecko', 'CoinGecko');
    if (result.isErr()) {
      return err(result.error);
    }

    this.providerIdCache = result.value.id;
    return ok(result.value.id);
  }

  /**
   * Fetch price from CoinGecko API (historical or simple)
   */
  private async fetchFromApi(
    coinId: string,
    asset: Currency,
    timestamp: Date,
    currency: Currency
  ): Promise<Result<PriceData, Error>> {
    try {
      const now = new Date();

      // Use simple price API for recent data (faster)
      if (canUseSimplePrice(timestamp)) {
        this.logger.debug({ coinId, asset }, 'Using simple price API');

        // Build query params
        const params = new URLSearchParams({
          ids: coinId,
          vs_currencies: currency.toLowerCase(),
        });

        const rawResponse = await this.httpClient.get<unknown>(`/simple/price?${params.toString()}`, {
          headers: {
            'x-cg-demo-api-key': this.config.apiKey || '',
          },
        });

        const parseResult = CoinGeckoSimplePriceResponseSchema.safeParse(rawResponse);
        if (!parseResult.success) {
          return err(new Error(`Invalid simple price response: ${parseResult.error.message}`));
        }

        // Transform using pure function
        const priceDataResult = transformSimplePriceResponse(parseResult.data, coinId, asset, timestamp, currency, now);
        if (priceDataResult.isErr()) {
          return err(priceDataResult.error);
        }
        return ok(priceDataResult.value);
      }

      // Use historical API for older data
      this.logger.debug({ coinId, asset, timestamp }, 'Using historical price API');

      // Check if this is an intraday request (has specific time, not midnight UTC)
      const isIntradayRequest =
        timestamp.getUTCHours() !== 0 || timestamp.getUTCMinutes() !== 0 || timestamp.getUTCSeconds() !== 0;
      if (isIntradayRequest) {
        this.logger.warn(
          { asset: asset.toString(), timestamp },
          'CoinGecko historical API only provides daily prices - intraday granularity not available'
        );
      }

      const date = formatCoinGeckoDate(timestamp);
      const params = new URLSearchParams({
        date,
        localization: 'false',
      });

      const rawResponse = await this.httpClient.get<unknown>(`/coins/${coinId}/history?${params.toString()}`, {
        headers: {
          'x-cg-demo-api-key': this.config.apiKey || '',
        },
      });

      const parseResult = CoinGeckoHistoricalPriceResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid historical price response: ${parseResult.error.message}`));
      }

      // Transform using pure function
      const priceDataResult = transformHistoricalResponse(parseResult.data, asset, timestamp, currency, now);
      if (priceDataResult.isErr()) {
        return err(priceDataResult.error);
      }
      return ok(priceDataResult.value);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new Error(`API fetch failed: ${message}`));
    }
  }
}

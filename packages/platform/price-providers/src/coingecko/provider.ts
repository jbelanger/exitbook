/**
 * CoinGecko price provider implementation
 */

import { Currency, getErrorMessage, wrapError } from '@exitbook/core';
import { HttpClient } from '@exitbook/platform-http';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesDB } from '../pricing/database.ts';
import { PriceRepository } from '../pricing/repositories/price-repository.js';
import { ProviderRepository } from '../pricing/repositories/provider-repository.js';
import { BasePriceProvider } from '../shared/base-provider.js';
import type { PriceData, PriceQuery, ProviderMetadata } from '../shared/types/index.js';

import {
  buildBatchSimplePriceParams,
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
 * This factory handles:
 * - Repository creation
 * - HTTP client configuration
 * - Provider instantiation
 *
 * @param db - Initialized prices database instance
 * @param config - Provider configuration (API key, Pro API flag)
 */
export function createCoinGeckoProvider(
  db: PricesDB,
  config: CoinGeckoProviderConfig = {}
): Result<CoinGeckoProvider, Error> {
  try {
    // Read from environment if not provided in config (similar to blockchain providers)
    // This allows direct provider creation (e.g., in tests) to automatically pick up env vars
    const apiKey = config.apiKey ?? process.env.COINGECKO_API_KEY;
    const useProApi = config.useProApi ?? process.env.COINGECKO_USE_PRO_API === 'true';

    // Determine base URL based on API type
    const baseUrl = useProApi ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';

    // Create HTTP client with CoinGecko-specific configuration
    const httpClient = new HttpClient({
      baseUrl,
      defaultHeaders: {
        Accept: 'application/json',
        ...(apiKey && { 'x-cg-demo-api-key': apiKey }),
      },
      providerName: 'CoinGecko',
      rateLimit: {
        // Free tier: 10-50 calls/minute, Pro: higher limits
        burstLimit: useProApi ? 100 : apiKey ? 10 : 1, // Allow 10 burst requests for free tier
        requestsPerHour: useProApi ? 500 : 500,
        requestsPerMinute: useProApi ? 50 : 10, // 30 calls/minute for free tier
        requestsPerSecond: useProApi ? 1.0 : apiKey ? 0.5 : 0.1, // Allow higher burst rate
      },
      retries: 3,
      timeout: 10000,
    });

    // Create repositories
    const providerRepo = new ProviderRepository(db);
    const priceRepo = new PriceRepository(db);

    // Create provider config
    const providerConfig: CoinGeckoProviderConfig = {
      apiKey,
      useProApi,
    };

    // Instantiate provider
    const provider = new CoinGeckoProvider(httpClient, providerRepo, priceRepo, providerConfig);

    return ok(provider);
  } catch (error) {
    const message = getErrorMessage(error);
    return err(new Error(`Failed to create CoinGecko provider: ${message}`));
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
  private readonly logger = getLogger('CoinGeckoProvider');
  private readonly httpClient: HttpClient;
  private readonly providerRepo: ProviderRepository;
  private readonly priceRepo: PriceRepository;
  private readonly config: CoinGeckoProviderConfig;

  // Cache provider ID after first lookup
  private providerIdCache: number | undefined;

  constructor(
    httpClient: HttpClient,
    providerRepo: ProviderRepository,
    priceRepo: PriceRepository,
    config: CoinGeckoProviderConfig = {}
  ) {
    super();

    this.httpClient = httpClient;
    this.providerRepo = providerRepo;
    this.priceRepo = priceRepo;
    this.config = config;

    // Provider metadata
    this.metadata = {
      capabilities: {
        maxBatchSize: 100,
        supportedCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'],
        supportedOperations: ['fetchPrice', 'fetchBatch'],
      },
      displayName: 'CoinGecko',
      name: 'coingecko',
      priority: 1,
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

      // Group queries by whether they can use simple price API
      const recentQueries = queries.filter((q) => canUseSimplePrice(q.timestamp));
      const historicalQueries = queries.filter((q) => !canUseSimplePrice(q.timestamp));

      this.logger.info(
        { recentCount: recentQueries.length, historicalCount: historicalQueries.length },
        'Queries grouped'
      );

      const results: PriceData[] = [];

      // Fetch recent prices in batch
      if (recentQueries.length > 0) {
        this.logger.info(`Fetching ${recentQueries.length} recent prices via batch API`);
        const batchResult = await this.fetchBatchSimplePrice(recentQueries);
        if (batchResult.isOk()) {
          results.push(...batchResult.value);
          this.logger.info(`Batch API returned ${batchResult.value.length} prices`);
        } else {
          this.logger.error({ error: batchResult.error.message }, 'Batch API failed');
        }
      }

      // Fetch historical prices individually (can't batch)
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
   * Sync coin list from CoinGecko API
   *
   * Fetches top coins by market cap to ensure correct coin ID mapping
   * for symbols with multiple entries (e.g., BTC maps to Bitcoin, not batcat)
   */
  async syncCoinList(): Promise<Result<number, Error>> {
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
      // Reduce to 2 pages (500 coins) to avoid rate limiting on free tier
      for (let page = 1; page <= 2; page++) {
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
        this.logger.debug({ page, count: marketParseResult.data.length }, 'Fetched markets page');
      }

      this.logger.debug({ count: allMarketCoins.length }, 'Market coins fetched successfully');

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
        return err(new Error(`No CoinGecko coin ID found for symbol: ${query.asset.toString()}`));
      }

      // 4. Fetch from API
      const priceData = await this.fetchFromApi(coinId, query.asset, query.timestamp, currency);
      if (priceData.isErr()) {
        return err(priceData.error);
      }

      // 5. Cache the result
      const cacheResult = await this.priceRepo.savePrice(priceData.value, coinId);
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
        const priceData = transformSimplePriceResponse(parseResult.data, coinId, asset, timestamp, currency, now);
        return ok(priceData);
      }

      // Use historical API for older data
      this.logger.debug({ coinId, asset, timestamp }, 'Using historical price API');

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
      const priceData = transformHistoricalResponse(parseResult.data, asset, timestamp, currency, now);
      return ok(priceData);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new Error(`API fetch failed: ${message}`));
    }
  }

  /**
   * Fetch multiple prices using simple price API (batch)
   */
  private async fetchBatchSimplePrice(queries: PriceQuery[]): Promise<Result<PriceData[], Error>> {
    try {
      const providerId = await this.ensureProviderRegistered();
      if (providerId.isErr()) {
        return err(providerId.error);
      }

      // Get coin IDs for all symbols
      const coinIds: string[] = [];
      const queryMap = new Map<string, PriceQuery[]>();

      for (const query of queries) {
        const coinIdResult = await this.providerRepo.getCoinIdForSymbol(providerId.value, query.asset);

        if (coinIdResult.isOk() && coinIdResult.value) {
          coinIds.push(coinIdResult.value);

          if (!queryMap.has(coinIdResult.value)) {
            queryMap.set(coinIdResult.value, []);
          }
          queryMap.get(coinIdResult.value)!.push(query);
        } else {
          this.logger.warn(
            { asset: query.asset.toString(), error: coinIdResult.isErr() ? coinIdResult.error.message : 'No coin ID' },
            'Failed to get coin ID for asset'
          );
        }
      }

      if (coinIds.length === 0) {
        this.logger.error(
          { queriedAssets: queries.map((q) => q.asset.toString()) },
          'No valid coin IDs found for any assets'
        );
        return err(new Error('No valid coin IDs found for batch queries'));
      }

      this.logger.info(
        { coinIds: [...new Set(coinIds)], queryCurrency: queries[0]?.currency?.toString() || 'USD' },
        'Mapped assets to coin IDs'
      );

      // Build params using pure function
      const currency = queries[0]?.currency || Currency.create('USD');
      const params = buildBatchSimplePriceParams(coinIds, currency);

      // Convert params to URLSearchParams
      const searchParams = new URLSearchParams(params);

      // Fetch batch
      const rawResponse = await this.httpClient.get<unknown>(`/simple/price?${searchParams.toString()}`, {
        headers: {
          'x-cg-demo-api-key': this.config.apiKey || '',
        },
      });

      const parseResult = CoinGeckoSimplePriceResponseSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid simple price response: ${parseResult.error.message}`));
      }

      // Transform responses
      const now = new Date();
      const results: PriceData[] = [];

      for (const [coinId, relatedQueries] of queryMap.entries()) {
        for (const query of relatedQueries) {
          try {
            const priceData = transformSimplePriceResponse(
              parseResult.data,
              coinId,
              query.asset,
              query.timestamp,
              currency,
              now
            );
            results.push(priceData);

            // Cache the result
            await this.priceRepo.savePrice(priceData, coinId);
          } catch (error) {
            this.logger.warn({ error, coinId }, 'Failed to transform price for coin');
          }
        }
      }

      return ok(results);
    } catch (error) {
      const message = getErrorMessage(error);
      return err(new Error(`Batch simple price fetch failed: ${message}`));
    }
  }
}

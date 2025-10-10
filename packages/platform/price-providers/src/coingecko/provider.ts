/**
 * CoinGecko price provider implementation
 */

import { HttpClient } from '@exitbook/platform-http';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { createPricesDatabase, initializePricesDatabase } from '../pricing/database.ts';
import { PriceRepository } from '../pricing/repositories/price-repository.js';
import { ProviderRepository } from '../pricing/repositories/provider-repository.js';
import { BasePriceProvider } from '../shared/base-provider.js';
import { normalizeAssetSymbol, normalizeCurrency } from '../shared/price-utils.js';
import type { PriceData, PriceQuery, ProviderMetadata } from '../shared/types/index.js';

import {
  buildBatchSimplePriceParams,
  buildSymbolToCoinIdMap,
  canUseSimplePrice,
  formatCoinGeckoDate,
  transformHistoricalResponse,
  transformSimplePriceResponse,
} from './coingecko-utils.js';
import {
  CoinGeckoCoinListSchema,
  CoinGeckoHistoricalPriceResponseSchema,
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
  /** Path to prices database file (defaults to ./data/prices.db) */
  databasePath?: string | undefined;
}

/**
 * Create a fully configured CoinGecko provider
 *
 * This factory handles:
 * - Database initialization
 * - Repository creation
 * - HTTP client configuration
 * - Provider instantiation
 */
export async function createCoinGeckoProvider(
  config: CoinGeckoProviderConfig = {}
): Promise<Result<CoinGeckoProvider, Error>> {
  try {
    // Determine base URL based on API type
    const baseUrl = config.useProApi ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';

    // Create HTTP client with CoinGecko-specific configuration
    const httpClient = new HttpClient({
      baseUrl,
      defaultHeaders: {
        Accept: 'application/json',
        ...(config.apiKey && { 'x-cg-demo-api-key': config.apiKey }),
      },
      providerName: 'CoinGecko',
      rateLimit: {
        // Free tier: 10-50 calls/minute, Pro: higher limits
        burstLimit: config.useProApi ? 100 : 30,
        requestsPerHour: config.useProApi ? 500 : 500,
        requestsPerMinute: config.useProApi ? 50 : 30,
        requestsPerSecond: config.useProApi ? 1.0 : 0.5,
      },
      retries: 3,
      timeout: 10000,
    });

    // Create database
    const dbPath = config.databasePath || './data/prices.db';
    const dbResult = createPricesDatabase(dbPath);

    if (dbResult.isErr()) {
      return err(new Error(`Failed to create prices database: ${dbResult.error.message}`));
    }

    const db = dbResult.value;

    // Run migrations
    const migrationResult = await initializePricesDatabase(db);
    if (migrationResult.isErr()) {
      return err(new Error(`Failed to run migrations: ${migrationResult.error.message}`));
    }

    // Create repositories
    const providerRepo = new ProviderRepository(db);
    const priceRepo = new PriceRepository(db);

    // Create provider config
    const providerConfig: CoinGeckoProviderConfig = {
      apiKey: config.apiKey,
      useProApi: config.useProApi,
    };

    // Instantiate provider
    const provider = new CoinGeckoProvider(httpClient, providerRepo, priceRepo, providerConfig);

    return ok(provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
      // Group queries by whether they can use simple price API
      const recentQueries = queries.filter((q) => canUseSimplePrice(q.timestamp));
      const historicalQueries = queries.filter((q) => !canUseSimplePrice(q.timestamp));

      const results: PriceData[] = [];

      // Fetch recent prices in batch
      if (recentQueries.length > 0) {
        const batchResult = await this.fetchBatchSimplePrice(recentQueries);
        if (batchResult.isOk()) {
          results.push(...batchResult.value);
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
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Batch fetch failed: ${message}`));
    }
  }

  /**
   * Sync coin list from CoinGecko API
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

      // 3. Fetch coin list from API
      this.logger.debug('Fetching coin list from CoinGecko API');
      const rawResponse = await this.httpClient.get<unknown>('/coins/list');

      // 4. Validate response
      const parseResult = CoinGeckoCoinListSchema.safeParse(rawResponse);
      if (!parseResult.success) {
        return err(new Error(`Invalid coin list response: ${parseResult.error.message}`));
      }

      const coinList = parseResult.data;
      this.logger.debug({ count: coinList.length }, 'Coin list fetched successfully');

      // 5. Build mappings using pure function
      const symbolMap = buildSymbolToCoinIdMap(coinList);

      // 6. Convert Map to array for DB storage
      const mappings = Array.from(symbolMap.entries()).map(([symbol, coinId]) => {
        const coin = coinList.find((c) => c.id === coinId)!;
        return {
          coin_id: coinId,
          coin_name: coin.name,
          symbol,
        };
      });

      // 7. Store mappings in DB
      const upsertResult = await this.providerRepo.upsertCoinMappings(providerId, mappings);
      if (upsertResult.isErr()) {
        return err(upsertResult.error);
      }

      // 8. Update sync timestamp
      const updateResult = await this.providerRepo.updateProviderSync(providerId, mappings.length);
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }

      this.logger.info({ count: mappings.length }, 'Coin list synced successfully');
      return ok(mappings.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Coin list sync failed: ${message}`));
    }
  }

  /**
   * Fetch single price (implements BasePriceProvider)
   */
  protected async fetchPriceImpl(query: PriceQuery): Promise<Result<PriceData, Error>> {
    try {
      const asset = normalizeAssetSymbol(query.asset);
      const currency = normalizeCurrency(query.currency || 'USD');

      // 1. Check cache first
      const cachedResult = await this.priceRepo.getPrice(asset, currency, query.timestamp);

      if (cachedResult.isErr()) {
        return err(cachedResult.error);
      }

      if (cachedResult.value) {
        this.logger.debug({ asset, currency, timestamp: query.timestamp }, 'Price found in cache');
        return ok(cachedResult.value);
      }

      // 2. Ensure provider is registered and synced
      const providerIdResult = await this.ensureProviderRegistered();
      if (providerIdResult.isErr()) {
        return err(providerIdResult.error);
      }
      const providerId = providerIdResult.value;

      // 3. Get coin ID for symbol
      const coinIdResult = await this.providerRepo.getCoinIdForSymbol(providerId, asset);
      if (coinIdResult.isErr()) {
        return err(coinIdResult.error);
      }

      const coinId = coinIdResult.value;
      if (!coinId) {
        return err(new Error(`No CoinGecko coin ID found for symbol: ${asset}`));
      }

      // 4. Fetch from API
      const priceData = await this.fetchFromApi(coinId, asset, query.timestamp, currency);
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
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`CoinGecko fetch failed: ${message}`));
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
    asset: string,
    timestamp: Date,
    currency: string
  ): Promise<Result<PriceData, Error>> {
    try {
      const now = new Date();

      // Use simple price API for recent data (faster)
      if (canUseSimplePrice(timestamp)) {
        this.logger.debug({ coinId, asset }, 'Using simple price API');

        const rawResponse = await this.httpClient.get<unknown>('/simple/price', {
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
      const rawResponse = await this.httpClient.get<unknown>(`/coins/${coinId}/history`, {
        headers: {
          date,
          localization: 'false',
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
      const message = error instanceof Error ? error.message : String(error);
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
        const asset = normalizeAssetSymbol(query.asset);
        const coinIdResult = await this.providerRepo.getCoinIdForSymbol(providerId.value, asset);

        if (coinIdResult.isOk() && coinIdResult.value) {
          coinIds.push(coinIdResult.value);

          if (!queryMap.has(coinIdResult.value)) {
            queryMap.set(coinIdResult.value, []);
          }
          queryMap.get(coinIdResult.value)!.push(query);
        }
      }

      if (coinIds.length === 0) {
        return err(new Error('No valid coin IDs found for batch queries'));
      }

      // Build params using pure function
      const currency = normalizeCurrency(queries[0]?.currency || 'USD');
      const params = buildBatchSimplePriceParams(coinIds, currency);

      // Fetch batch
      const rawResponse = await this.httpClient.get<unknown>('/simple/price', {
        headers: {
          ...params,
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
            const asset = normalizeAssetSymbol(query.asset);
            const priceData = transformSimplePriceResponse(
              parseResult.data,
              coinId,
              asset,
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
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Batch simple price fetch failed: ${message}`));
    }
  }
}

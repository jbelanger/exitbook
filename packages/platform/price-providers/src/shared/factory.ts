/**
 * Factory for creating all price providers
 *
 * Centralized provider creation with environment variable support
 */

import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err } from 'neverthrow';

import { createCoinGeckoProvider } from '../coingecko/provider.ts';
import { createPricesDatabase, initializePricesDatabase } from '../pricing/database.ts';

import type { IPriceProvider } from './types/index.js';

const logger = getLogger('PriceProviderFactory');

/**
 * Configuration for individual providers
 */
export interface ProviderFactoryConfig {
  /** Path to prices database file (defaults to ./data/prices.db) */
  databasePath?: string | undefined;
  coingecko?: {
    apiKey?: string | undefined;
    enabled?: boolean | undefined;
    useProApi?: boolean | undefined;
  };
  // Future providers:
  // coinmarketcap?: { ... };
  // binance?: { ... };
}

/**
 * Create all enabled price providers
 *
 * Providers are enabled if:
 * - Not explicitly disabled in config
 * - API key is available (if required)
 *
 * Example usage:
 * ```typescript
 * // Use environment variables
 * const providers = await createPriceProviders();
 *
 * // Override with config
 * const providers = await createPriceProviders({
 *   databasePath: './custom/prices.db',
 *   coingecko: { apiKey: 'my-key', useProApi: true }
 * });
 *
 * // Disable specific provider
 * const providers = await createPriceProviders({
 *   coingecko: { enabled: false }
 * });
 * ```
 */
export async function createPriceProviders(config: ProviderFactoryConfig = {}): Promise<IPriceProvider[]> {
  const providers: IPriceProvider[] = [];

  // Initialize database (shared by all providers)
  const dbPath = config.databasePath || './data/prices.db';
  const dbResult = createPricesDatabase(dbPath);

  if (dbResult.isErr()) {
    logger.error(`Failed to create prices database: ${dbResult.error.message}`);
    return providers;
  }

  const db = dbResult.value;

  // Run migrations
  const migrationResult = await initializePricesDatabase(db);
  if (migrationResult.isErr()) {
    logger.error(`Failed to run database migrations: ${migrationResult.error.message}`);
    return providers;
  }

  logger.debug({ databasePath: dbPath }, 'Prices database initialized');

  // CoinGecko Provider
  const coingeckoConfig = config.coingecko;
  if (coingeckoConfig?.enabled !== false) {
    const apiKey = coingeckoConfig?.apiKey || process.env.COINGECKO_API_KEY;
    const useProApi = coingeckoConfig?.useProApi || process.env.COINGECKO_USE_PRO_API === 'true';

    const result = createCoinGeckoProvider(db, {
      apiKey,
      useProApi,
    });

    if (result.isOk()) {
      providers.push(result.value);
      logger.info(`CoinGecko provider registered (Pro API: ${useProApi})`);
    } else {
      logger.warn(`Failed to create CoinGecko provider: ${result.error.message}`);
    }
  } else {
    logger.debug('CoinGecko provider disabled via config');
  }

  // Future providers can be added here:
  //
  // // CoinMarketCap Provider
  // if (config.coinmarketcap?.enabled !== false) {
  //   const result = await createCoinMarketCapProvider({ ... });
  //   if (result.isOk()) {
  //     providers.push(result.value);
  //   }
  // }

  if (providers.length === 0) {
    logger.warn('No price providers were successfully created. Price fetching will not be available.');
  } else {
    logger.info(
      `Successfully created ${providers.length} price provider(s): ${providers.map((p) => p.getMetadata().name).join(', ')}`
    );
  }

  return providers;
}

/**
 * Create a single provider by name
 *
 * Useful for dynamic provider selection or testing
 *
 * @param name - Provider name (e.g., 'coingecko')
 * @param config - Combined config including database path and provider-specific settings
 */
export async function createPriceProviderByName(
  name: string,
  config: ProviderFactoryConfig = {}
): Promise<Result<IPriceProvider, Error>> {
  // Initialize database
  const dbPath = config.databasePath || './data/prices.db';
  const dbResult = createPricesDatabase(dbPath);

  if (dbResult.isErr()) {
    return err(new Error(`Failed to create prices database: ${dbResult.error.message}`));
  }

  const db = dbResult.value;

  // Run migrations
  const migrationResult = await initializePricesDatabase(db);
  if (migrationResult.isErr()) {
    return err(new Error(`Failed to run database migrations: ${migrationResult.error.message}`));
  }

  switch (name.toLowerCase()) {
    case 'coingecko': {
      const coingeckoConfig = config.coingecko || {};
      const apiKey = coingeckoConfig.apiKey || process.env.COINGECKO_API_KEY;
      const useProApi = coingeckoConfig.useProApi || process.env.COINGECKO_USE_PRO_API === 'true';

      return createCoinGeckoProvider(db, {
        apiKey,
        useProApi,
      });
    }

    // Future providers:
    // case 'coinmarketcap':
    //   return createCoinMarketCapProvider(db, config.coinmarketcap || {});

    default:
      return err(new Error(`Unknown provider: ${name}`));
  }
}

/**
 * Get list of available provider names
 */
export function getAvailableProviderNames(): string[] {
  return [
    'coingecko',
    // Future: 'coinmarketcap', 'binance', etc.
  ];
}

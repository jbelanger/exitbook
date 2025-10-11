/**
 * Factory for creating all price providers
 *
 * Centralized provider creation with environment variable support
 */

import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err } from 'neverthrow';

import { createCoinGeckoProvider } from '../coingecko/provider.ts';
import { createCryptoCompareProvider } from '../cryptocompare/provider.ts';
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
  cryptocompare?: {
    apiKey?: string | undefined;
    enabled?: boolean | undefined;
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
 *   coingecko: { apiKey: 'my-key', useProApi: true },
 *   cryptocompare: { apiKey: 'my-key' }
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
    // Debug: Check what's in process.env
    logger.debug(
      {
        hasEnvVar: !!process.env.COINGECKO_API_KEY,
        envVarLength: process.env.COINGECKO_API_KEY?.length || 0,
        configApiKey: !!coingeckoConfig?.apiKey,
      },
      'Checking CoinGecko API key sources'
    );

    const apiKey = coingeckoConfig?.apiKey || process.env.COINGECKO_API_KEY;
    const useProApi = coingeckoConfig?.useProApi || process.env.COINGECKO_USE_PRO_API === 'true';

    // Log API key status (without exposing the key)
    if (apiKey) {
      logger.info(`CoinGecko API key found (length: ${apiKey.length}, first 8 chars: ${apiKey.substring(0, 8)}...)`);
    } else {
      logger.warn(
        'No CoinGecko API key found. Using free tier with strict rate limits (10-30 calls/min). Set COINGECKO_API_KEY in .env for better rate limits.'
      );
    }

    const result = createCoinGeckoProvider(db, {
      apiKey,
      useProApi,
    });

    if (result.isOk()) {
      const provider = result.value;

      // Sync coin list (required for symbol -> coin ID mapping)
      logger.info('Syncing CoinGecko coin list...');
      const syncResult = await provider.syncCoinList();
      if (syncResult.isErr()) {
        logger.error(`Failed to sync CoinGecko coin list: ${syncResult.error.message}`);
        // Don't add provider if sync fails - it won't work without coin mappings
        return providers; // Return empty providers array instead of undefined
      } else {
        logger.info(`Synced ${syncResult.value} coins from CoinGecko`);
      }

      providers.push(provider);
      logger.info(`CoinGecko provider registered (Pro API: ${useProApi})`);
    } else {
      logger.warn(`Failed to create CoinGecko provider: ${result.error.message}`);
    }
  } else {
    logger.debug('CoinGecko provider disabled via config');
  }

  // CryptoCompare Provider
  const cryptocompareConfig = config.cryptocompare;
  if (cryptocompareConfig?.enabled !== false) {
    const apiKey = cryptocompareConfig?.apiKey || process.env.CRYPTOCOMPARE_API_KEY;

    // Log API key status (without exposing the key)
    if (apiKey) {
      logger.debug(
        `CryptoCompare API key found (length: ${apiKey.length}, first 8 chars: ${apiKey.substring(0, 8)}...)`
      );
    } else {
      logger.info(
        'No CryptoCompare API key found. Using free tier with rate limits (~100,000 calls/month). Set CRYPTOCOMPARE_API_KEY in .env for better rate limits.'
      );
    }

    const result = createCryptoCompareProvider(db, {
      apiKey,
    });

    if (result.isOk()) {
      providers.push(result.value);
      logger.info('CryptoCompare provider registered');
    } else {
      logger.warn(`Failed to create CryptoCompare provider: ${result.error.message}`);
    }
  } else {
    logger.debug('CryptoCompare provider disabled via config');
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
    logger.debug(
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

      const result = createCoinGeckoProvider(db, {
        apiKey,
        useProApi,
      });

      if (result.isOk()) {
        // Sync coin list before returning
        const syncResult = await result.value.syncCoinList();
        if (syncResult.isErr()) {
          logger.warn(`Failed to sync CoinGecko coin list: ${syncResult.error.message}`);
        }
      }

      return result;
    }

    case 'cryptocompare': {
      const cryptocompareConfig = config.cryptocompare || {};
      const apiKey = cryptocompareConfig.apiKey || process.env.CRYPTOCOMPARE_API_KEY;

      return createCryptoCompareProvider(db, {
        apiKey,
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
    'cryptocompare',
    // Future: 'coinmarketcap', 'binance', etc.
  ];
}

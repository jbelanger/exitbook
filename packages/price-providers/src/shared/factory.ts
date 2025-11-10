/**
 * Factory for creating all price providers
 *
 * Auto-discovers providers via registry pattern
 */

import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { createBankOfCanadaProvider } from '../bank-of-canada/provider.js';
import { createBinanceProvider } from '../binance/provider.js';
import { createCoinGeckoProvider } from '../coingecko/provider.js';
import { createCryptoCompareProvider } from '../cryptocompare/provider.js';
import { createECBProvider } from '../ecb/provider.js';
import { createFrankfurterProvider } from '../frankfurter/provider.js';
import type { PricesDB } from '../persistence/database.js';
import { createPricesDatabase, initializePricesDatabase } from '../persistence/database.js';

import { PriceProviderManager } from './provider-manager.js';
import type { IPriceProvider, ProviderManagerConfig } from './types/index.js';

const logger = getLogger('PriceProviderFactory');

/**
 * Registry of available provider factories
 *
 * To add a new provider:
 * 1. Import the factory function
 * 2. Add it to this object
 *
 * Type-safe: All factories must match the expected signature
 */
const PROVIDER_FACTORIES = {
  'bank-of-canada': (db: PricesDB, _config: unknown) => createBankOfCanadaProvider(db),
  binance: (db: PricesDB, config: unknown) =>
    createBinanceProvider(db, config as Parameters<typeof createBinanceProvider>[1]),
  coingecko: (db: PricesDB, config: unknown) =>
    createCoinGeckoProvider(db, config as Parameters<typeof createCoinGeckoProvider>[1]),
  cryptocompare: (db: PricesDB, config: unknown) =>
    createCryptoCompareProvider(db, config as Parameters<typeof createCryptoCompareProvider>[1]),
  ecb: (db: PricesDB, _config: unknown) => createECBProvider(db),
  frankfurter: (db: PricesDB, _config: unknown) => createFrankfurterProvider(db),
} as const satisfies Record<string, (db: PricesDB, config: unknown) => Result<IPriceProvider, Error>>;

export type ProviderName = keyof typeof PROVIDER_FACTORIES;

/**
 * Configuration for individual providers
 */
export interface ProviderFactoryConfig {
  /** Path to prices database file (defaults to ./data/prices.db) */
  databasePath?: string | undefined;
  'bank-of-canada'?: {
    enabled?: boolean | undefined;
  };
  binance?: {
    enabled?: boolean | undefined;
  };
  coingecko?: {
    apiKey?: string | undefined;
    enabled?: boolean | undefined;
    useProApi?: boolean | undefined;
  };
  cryptocompare?: {
    apiKey?: string | undefined;
    enabled?: boolean | undefined;
  };
  ecb?: {
    enabled?: boolean | undefined;
  };
  frankfurter?: {
    enabled?: boolean | undefined;
  };
}

/**
 * Create all enabled price providers
 *
 * Providers are enabled if:
 * - Not explicitly disabled in config
 * - Successfully created and initialized
 *
 * Example usage:
 * ```typescript
 * // Use environment variables (auto-detected by individual factories)
 * const result = await createPriceProviders();
 *
 * // Override with config
 * const result = await createPriceProviders({
 *   databasePath: './custom/prices.db',
 *   coingecko: { apiKey: 'my-key', useProApi: true },
 *   cryptocompare: { apiKey: 'my-key' }
 * });
 *
 * // Disable specific provider
 * const result = await createPriceProviders({
 *   coingecko: { enabled: false }
 * });
 *
 * if (result.isErr()) {
 *   console.error('Failed to create providers:', result.error);
 *   return;
 * }
 *
 * const providers = result.value;
 * ```
 */
export async function createPriceProviders(
  config: ProviderFactoryConfig = {}
): Promise<Result<IPriceProvider[], Error>> {
  // Initialize database (internal detail - caller never touches it)
  const dbPath = config.databasePath || './data/prices.db';
  const dbResult = createPricesDatabase(dbPath);

  if (dbResult.isErr()) {
    return err(new Error(`Failed to create prices database: ${dbResult.error.message}`));
  }

  const db = dbResult.value;

  // Run migrations
  const migrationResult = await initializePricesDatabase(db);
  if (migrationResult.isErr()) {
    return err(new Error(`Failed to initialize database: ${migrationResult.error.message}`));
  }

  logger.debug({ databasePath: dbPath }, 'Prices database initialized');

  const providers: IPriceProvider[] = [];

  // Auto-discover and create all providers from registry
  for (const [name, factory] of Object.entries(PROVIDER_FACTORIES)) {
    const providerConfig = config[name as ProviderName];

    // Check if explicitly disabled
    if (providerConfig?.enabled === false) {
      logger.debug(`${name} provider disabled via config`);
      continue;
    }

    // Create provider using factory
    const result = factory(db, providerConfig || {});
    if (result.isErr()) {
      logger.warn(`Failed to create ${name} provider: ${result.error.message}`);
      continue;
    }

    const provider: IPriceProvider = result.value;

    // Call optional initialize hook (e.g., sync coin lists)
    if (provider.initialize) {
      logger.info(`Initializing ${name} provider...`);
      const initResult = await provider.initialize();
      if (initResult.isErr()) {
        logger.error(`Failed to initialize ${name} provider: ${initResult.error.message}`);
        continue; // Skip this provider
      }
      logger.info(`${name} provider initialized successfully`);
    }

    providers.push(provider);
    logger.info(`${name} provider registered`);
  }

  if (providers.length === 0) {
    return err(new Error('No price providers were successfully created. Check logs for details.'));
  }

  logger.info(
    `Successfully created ${providers.length} price provider(s): ${providers.map((p) => p.getMetadata().name).join(', ')}`
  );

  return ok(providers);
}

/**
 * Get list of available provider names (dynamic - derived from registry)
 */
export function getAvailableProviderNames(): ProviderName[] {
  return Object.keys(PROVIDER_FACTORIES) as ProviderName[];
}

/**
 * Combined configuration for provider manager creation
 */
export interface PriceProviderManagerFactoryConfig {
  /** Provider-specific configuration */
  providers?: ProviderFactoryConfig | undefined;
  /** Manager-specific configuration */
  manager?: Partial<ProviderManagerConfig> | undefined;
}

/**
 * Create a fully configured PriceProviderManager with providers registered
 *
 * This is a convenience function that combines provider creation and manager setup
 * in a single step, simplifying the initialization process.
 *
 * Example usage:
 * ```typescript
 * // Use environment variables
 * const manager = await createPriceProviderManager();
 *
 * // Override with config
 * const manager = await createPriceProviderManager({
 *   providers: {
 *     databasePath: './custom/prices.db',
 *     coingecko: { apiKey: 'my-key', useProApi: true },
 *     cryptocompare: { enabled: false }
 *   },
 *   manager: {
 *     defaultCurrency: 'EUR',
 *     cacheTtlSeconds: 600
 *   }
 * });
 *
 * // Use the manager
 * const result = await manager.fetchPrice({
 *   asset: Currency.create('BTC'),
 *   timestamp: new Date(),
 *   currency: Currency.create('USD')
 * });
 * ```
 */
export async function createPriceProviderManager(
  config: PriceProviderManagerFactoryConfig = {}
): Promise<Result<PriceProviderManager, Error>> {
  // Create providers
  const providersResult = await createPriceProviders(config.providers ?? {});

  if (providersResult.isErr()) {
    return err(providersResult.error);
  }

  const providers = providersResult.value;

  // Create manager with config
  const manager = new PriceProviderManager({
    defaultCurrency: 'USD',
    maxConsecutiveFailures: 5,
    cacheTtlSeconds: 300,
    ...config.manager,
  });

  // Register providers
  manager.registerProviders(providers);

  logger.info('PriceProviderManager created and initialized successfully');

  return ok(manager);
}

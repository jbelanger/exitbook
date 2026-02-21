/**
 * Factory for creating all price providers
 *
 * Auto-discovers providers via registry pattern
 */

import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PriceProviderEvent } from '../events.js';
import type { PricesDB } from '../persistence/database.js';
import { createPricesDatabase, initializePricesDatabase } from '../persistence/database.js';
import { createBankOfCanadaProvider } from '../providers/bank-of-canada/provider.js';
import { createBinanceProvider } from '../providers/binance/provider.js';
import { createCoinGeckoProvider } from '../providers/coingecko/provider.js';
import { createCryptoCompareProvider } from '../providers/cryptocompare/provider.js';
import { createECBProvider } from '../providers/ecb/provider.js';
import { createFrankfurterProvider } from '../providers/frankfurter/provider.js';

import { PriceProviderManager } from './provider-manager.js';
import type { IPriceProvider, ProviderManagerConfig } from './types.js';

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
  'bank-of-canada': (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createBankOfCanadaProvider(db, config, instrumentation),
  binance: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createBinanceProvider(db, config as Parameters<typeof createBinanceProvider>[1], instrumentation),
  coingecko: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createCoinGeckoProvider(db, config as Parameters<typeof createCoinGeckoProvider>[1], instrumentation),
  cryptocompare: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createCryptoCompareProvider(db, config as Parameters<typeof createCryptoCompareProvider>[1], instrumentation),
  ecb: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createECBProvider(db, config, instrumentation),
  frankfurter: (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) =>
    createFrankfurterProvider(db, config, instrumentation),
} as const satisfies Record<
  string,
  (db: PricesDB, config: unknown, instrumentation?: InstrumentationCollector) => Result<IPriceProvider, Error>
>;

export type ProviderName = keyof typeof PROVIDER_FACTORIES;

/**
 * Configuration for individual providers
 */
export interface ProviderFactoryConfig {
  /** Path to prices database file */
  databasePath: string;
  /** Optional instrumentation collector to record HTTP metrics */
  instrumentation?: InstrumentationCollector | undefined;
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
 * const result = await createPriceProviders({
 *   databasePath: './data/prices.db'
 * });
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
 *   databasePath: './data/prices.db',
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
  config: ProviderFactoryConfig,
  instrumentation?: InstrumentationCollector,
  eventBus?: EventBus<PriceProviderEvent>
): Promise<Result<IPriceProvider[], Error>> {
  // Initialize database (internal detail - caller never touches it)
  const dbResult = createPricesDatabase(config.databasePath);

  if (dbResult.isErr()) {
    return err(new Error(`Failed to create prices database: ${dbResult.error.message}`));
  }

  const db = dbResult.value;

  // Run migrations
  const migrationResult = await initializePricesDatabase(db);
  if (migrationResult.isErr()) {
    return err(new Error(`Failed to initialize database: ${migrationResult.error.message}`));
  }

  logger.debug({ databasePath: config.databasePath }, 'Prices database initialized');

  const providers: IPriceProvider[] = [];
  const instrumentationCollector = instrumentation ?? config.instrumentation;

  eventBus?.emit({ type: 'providers.initializing' });

  // Auto-discover and create all providers from registry
  for (const [name, factory] of Object.entries(PROVIDER_FACTORIES)) {
    const providerConfig = config[name as ProviderName];

    // Check if explicitly disabled
    if (providerConfig?.enabled === false) {
      logger.debug(`${name} provider disabled via config`);
      continue;
    }

    // Create provider using factory
    const result = factory(db, providerConfig || {}, instrumentationCollector);
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

  eventBus?.emit({ type: 'providers.ready', providerCount: providers.length });

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
  providers: ProviderFactoryConfig;
  /** Manager-specific configuration */
  manager?: Partial<ProviderManagerConfig> | undefined;
  /** Optional instrumentation collector for HTTP metrics */
  instrumentation?: InstrumentationCollector | undefined;
  /** Optional event bus for provider lifecycle events */
  eventBus?: EventBus<PriceProviderEvent> | undefined;
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
 * const manager = await createPriceProviderManager({
 *   providers: { databasePath: './data/prices.db' }
 * });
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
 *   asset: 'BTC' as Currency,
 *   timestamp: new Date(),
 *   currency: 'USD' as Currency
 * });
 * ```
 */
export async function createPriceProviderManager(
  config: PriceProviderManagerFactoryConfig
): Promise<Result<PriceProviderManager, Error>> {
  // Create providers
  const providersResult = await createPriceProviders(config.providers, config.instrumentation, config.eventBus);

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

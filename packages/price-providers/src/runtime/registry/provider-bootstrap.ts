import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { PriceProviderEvent } from '../../contracts/events.js';
import type { IPriceProvider } from '../../contracts/types.js';
import { initPriceCacheDatabase } from '../../price-cache/persistence/runtime.js';

import { getAvailableProviderNames, PROVIDER_FACTORIES, type ProviderFactory } from './provider-registry.js';

const logger = getLogger('PriceProviderBootstrap');

/**
 * Configuration for individual providers.
 */
export interface ProviderFactoryConfig {
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
  /** Path to prices database file */
  databasePath: string;
  ecb?: {
    enabled?: boolean | undefined;
  };
  /** Optional event bus for provider lifecycle events */
  eventBus?: EventBus<PriceProviderEvent> | undefined;
  frankfurter?: {
    enabled?: boolean | undefined;
  };
  /** Optional instrumentation collector to record HTTP metrics */
  instrumentation?: InstrumentationCollector | undefined;
}

/**
 * Create all enabled price providers.
 */
export async function createPriceProviders(config: ProviderFactoryConfig): Promise<Result<IPriceProvider[], Error>> {
  const dbResult = await initPriceCacheDatabase(config.databasePath);
  if (dbResult.isErr()) {
    return err(dbResult.error);
  }

  const db = dbResult.value;
  const providers: IPriceProvider[] = [];
  const { instrumentation, eventBus } = config;

  eventBus?.emit({ type: 'providers.initializing' });

  for (const name of getAvailableProviderNames()) {
    const factory: ProviderFactory = PROVIDER_FACTORIES[name];
    const providerConfig = config[name];

    if (providerConfig?.enabled === false) {
      logger.debug(`${name} provider disabled via config`);
      continue;
    }

    const result = factory(db, providerConfig ?? {}, instrumentation);
    if (result.isErr()) {
      logger.warn(`Failed to create ${name} provider: ${result.error.message}`);
      continue;
    }

    const provider = result.value;

    if (provider.initialize) {
      logger.info(`Initializing ${name} provider...`);
      const initResult = await provider.initialize();
      if (initResult.isErr()) {
        logger.error(`Failed to initialize ${name} provider: ${initResult.error.message}`);
        continue;
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
  logger.info(`Successfully created ${providers.length} price provider(s): ${providers.map((p) => p.name).join(', ')}`);

  return ok(providers);
}

export { getAvailableProviderNames };

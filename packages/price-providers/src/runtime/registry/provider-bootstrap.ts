import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { PriceProviderEventSink } from '../../contracts/events.js';
import type { IPriceProvider } from '../../contracts/types.js';
import { initPriceCachePersistence } from '../../price-cache/persistence/runtime.js';

import { getAvailableProviderNames, getPriceProviderFactory } from './provider-registry.js';

const logger = getLogger('PriceProviderBootstrap');

interface InitializedPriceProviders {
  providers: IPriceProvider[];
  cleanup: () => Promise<void>;
}

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
  eventBus?: PriceProviderEventSink | undefined;
  frankfurter?: {
    enabled?: boolean | undefined;
  };
  /** Optional instrumentation collector to record HTTP metrics */
  instrumentation?: InstrumentationCollector | undefined;
}

/**
 * Create all enabled price providers.
 */
export async function createPriceProviders(
  config: ProviderFactoryConfig
): Promise<Result<InitializedPriceProviders, Error>> {
  const persistenceResult = await initPriceCachePersistence(config.databasePath);
  if (persistenceResult.isErr()) {
    return err(persistenceResult.error);
  }

  const persistence = persistenceResult.value;
  const providers: IPriceProvider[] = [];
  const { instrumentation, eventBus } = config;

  eventBus?.emit({ type: 'providers.initializing' });

  for (const name of getAvailableProviderNames()) {
    const factory = getPriceProviderFactory(name);
    const providerConfig = config[name];

    if (providerConfig?.enabled === false) {
      logger.debug(`${name} provider disabled via config`);
      continue;
    }

    const result = factory(persistence.database, providerConfig ?? {}, instrumentation);
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

        await provider.destroy().catch((error: unknown) => {
          logger.warn({ error }, 'Failed to destroy provider after initialization failure');
        });
        continue;
      }
      logger.info(`${name} provider initialized successfully`);
    }

    providers.push(provider);
    logger.info(`${name} provider registered`);
  }

  if (providers.length === 0) {
    await persistence.cleanup().catch((error: unknown) => {
      logger.warn({ error }, 'Failed to clean up price cache persistence after provider bootstrap failure');
    });

    return err(new Error('No price providers were successfully created. Check logs for details.'));
  }

  eventBus?.emit({ type: 'providers.ready', providerCount: providers.length });
  logger.info(`Successfully created ${providers.length} price provider(s): ${providers.map((p) => p.name).join(', ')}`);

  return ok({
    providers,
    cleanup: persistence.cleanup,
  });
}

export { getAvailableProviderNames };

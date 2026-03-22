import path from 'node:path';

import type { Result } from '@exitbook/foundation';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { PriceProviderEvent } from '../contracts/events.js';
import type { ProviderManagerConfig } from '../contracts/types.js';
import type { PriceProviderManager } from '../runtime/manager/provider-manager.js';
import {
  createPriceProviderManager,
  type PriceProviderManagerFactoryConfig,
} from '../runtime/registry/manager-bootstrap.js';

export interface DefaultPriceProviderManagerOptions {
  dataDir: string;
  eventBus?: EventBus<PriceProviderEvent> | undefined;
  instrumentation?: InstrumentationCollector | undefined;
  manager?: Partial<ProviderManagerConfig> | undefined;
}

export async function createDefaultPriceProviderManager(
  options: DefaultPriceProviderManagerOptions
): Promise<Result<PriceProviderManager, Error>> {
  const config: PriceProviderManagerFactoryConfig = {
    providers: {
      databasePath: path.join(options.dataDir, 'prices.db'),
      instrumentation: options.instrumentation,
      eventBus: options.eventBus,
      coingecko: {
        enabled: true,
        apiKey: process.env['COINGECKO_API_KEY'],
        useProApi: process.env['COINGECKO_USE_PRO_API'] === 'true',
      },
      cryptocompare: {
        enabled: true,
        apiKey: process.env['CRYPTOCOMPARE_API_KEY'],
      },
      ecb: {
        enabled: true,
      },
      'bank-of-canada': {
        enabled: true,
      },
      frankfurter: {
        enabled: true,
      },
    },
    manager: options.manager,
  };

  return createPriceProviderManager(config);
}

import path from 'node:path';

import type { PriceEvent } from '@exitbook/accounting';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/http';
import { createPriceProviderManager, type PriceProviderManager } from '@exitbook/price-providers';
import type { PriceProviderEvent } from '@exitbook/price-providers';
import { type Result } from 'neverthrow';

import { getDataDir } from '../shared/data-dir.js';

/**
 * Create default price provider manager with all providers enabled.
 * Reads configuration from process.env and data directory — CLI infrastructure only.
 */
export async function createDefaultPriceProviderManager(
  instrumentation?: InstrumentationCollector,
  // PriceEvent is a superset of PriceProviderEvent; cast is safe because the
  // price-providers package only ever calls bus.emit(PriceProviderEvent)
  eventBus?: EventBus<PriceEvent>
): Promise<Result<PriceProviderManager, Error>> {
  const dataDir = getDataDir();
  return createPriceProviderManager({
    providers: {
      databasePath: path.join(dataDir, 'prices.db'),
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
    manager: {
      defaultCurrency: 'USD',
      maxConsecutiveFailures: 3,
      cacheTtlSeconds: 3600,
    },
    instrumentation,
    eventBus: eventBus as EventBus<PriceProviderEvent> | undefined,
  });
}

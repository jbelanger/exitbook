import type { IHistoricalAssetPriceSource, PriceEvent } from '@exitbook/accounting';
import { err, ok, type Result } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';
import {
  createDefaultPriceProviderManager,
  type PriceProviderEvent,
  type PriceProviderManager,
} from '@exitbook/price-providers';

import { getDataDir } from './data-dir.js';

export interface OpenedPriceProviderRuntime {
  historicalAssetPriceSource: IHistoricalAssetPriceSource;
  cleanup: () => Promise<void>;
}

export async function openPriceProviderRuntime(options?: {
  dataDir?: string | undefined;
  eventBus?: EventBus<PriceEvent> | undefined;
  instrumentation?: InstrumentationCollector | undefined;
}): Promise<Result<OpenedPriceProviderRuntime, Error>> {
  const priceProviderManagerResult = await createDefaultPriceProviderManager({
    dataDir: options?.dataDir ?? getDataDir(),
    manager: {
      defaultCurrency: 'USD',
      maxConsecutiveFailures: 3,
      cacheTtlSeconds: 3600,
    },
    instrumentation: options?.instrumentation,
    // PriceEvent is a superset of PriceProviderEvent; cast is safe because the
    // price-providers package only ever calls bus.emit(PriceProviderEvent)
    eventBus: options?.eventBus as EventBus<PriceProviderEvent> | undefined,
  });
  if (priceProviderManagerResult.isErr()) {
    return err(priceProviderManagerResult.error);
  }

  const priceProviderManager = priceProviderManagerResult.value;
  return ok({
    historicalAssetPriceSource: createHistoricalAssetPriceSource(priceProviderManager),
    cleanup: async () => priceProviderManager.destroy(),
  });
}

function createHistoricalAssetPriceSource(priceProviderManager: PriceProviderManager): IHistoricalAssetPriceSource {
  return {
    async fetchPrice(query) {
      const priceResult = await priceProviderManager.fetchPrice(query);
      if (priceResult.isErr()) {
        return err(priceResult.error);
      }

      return ok(priceResult.value.data);
    },
  };
}

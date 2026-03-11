import type { PriceEvent } from '@exitbook/accounting';
import { type Result } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';
import {
  createDefaultPriceProviderManager as createHostedDefaultPriceProviderManager,
  type PriceProviderManager,
} from '@exitbook/price-providers';
import type { PriceProviderEvent } from '@exitbook/price-providers';

/**
 * Create default price provider manager with all providers enabled.
 * Uses the provider package's host-facing runtime factory.
 */
export async function createDefaultPriceProviderManager(
  dataDir: string,
  instrumentation?: InstrumentationCollector,
  // PriceEvent is a superset of PriceProviderEvent; cast is safe because the
  // price-providers package only ever calls bus.emit(PriceProviderEvent)
  eventBus?: EventBus<PriceEvent>
): Promise<Result<PriceProviderManager, Error>> {
  return createHostedDefaultPriceProviderManager({
    dataDir,
    manager: {
      defaultCurrency: 'USD',
      maxConsecutiveFailures: 3,
      cacheTtlSeconds: 3600,
    },
    instrumentation,
    eventBus: eventBus as EventBus<PriceProviderEvent> | undefined,
  });
}

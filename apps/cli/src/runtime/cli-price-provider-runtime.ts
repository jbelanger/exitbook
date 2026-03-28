import type { PricingEvent } from '@exitbook/accounting/price-enrichment';
import type { EventBus } from '@exitbook/events';
import { err, ok, type Result } from '@exitbook/foundation';
import type { InstrumentationCollector } from '@exitbook/observability';
import {
  createPriceProviderRuntime,
  type IPriceProviderRuntime,
  type PriceProviderConfig,
} from '@exitbook/price-providers';

import { getDataDir } from '../features/shared/data-dir.js';

import { buildPriceProviderConfigFromEnv } from './app-runtime.js';

export interface CliPriceProviderRuntimeOptions {
  dataDir?: string | undefined;
  eventBus?: EventBus<PricingEvent> | undefined;
  instrumentation?: InstrumentationCollector | undefined;
  providers?: PriceProviderConfig | undefined;
}

export async function openCliPriceProviderRuntime(
  options?: CliPriceProviderRuntimeOptions
): Promise<Result<IPriceProviderRuntime, Error>> {
  const runtimeResult = await createPriceProviderRuntime({
    dataDir: options?.dataDir ?? getDataDir(),
    providers: options?.providers ?? buildPriceProviderConfigFromEnv(),
    instrumentation: options?.instrumentation,
    eventBus: options?.eventBus,
  });
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  return ok(runtimeResult.value);
}

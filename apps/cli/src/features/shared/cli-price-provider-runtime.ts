import type { PricingEvent } from '@exitbook/accounting';
import type { EventBus } from '@exitbook/events';
import { err, ok, type Result } from '@exitbook/foundation';
import type { InstrumentationCollector } from '@exitbook/observability';
import {
  createPriceProviderRuntime,
  type IPriceProviderRuntime,
  type PriceProviderConfig,
} from '@exitbook/price-providers';

import { buildPriceProviderConfigFromEnv } from '../../runtime/app-runtime.js';

import { getDataDir } from './data-dir.js';

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

export async function withCliPriceProviderRuntime<T>(
  options: CliPriceProviderRuntimeOptions | undefined,
  operation: (runtime: IPriceProviderRuntime) => Promise<T>
): Promise<Result<T, Error>> {
  const runtimeResult = await openCliPriceProviderRuntime(options);
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  const priceRuntime = runtimeResult.value;

  let value: T | undefined;
  let operationError: Error | undefined;

  try {
    value = await operation(priceRuntime);
  } catch (error) {
    operationError = error instanceof Error ? error : new Error(String(error));
  }

  const cleanupResult = await priceRuntime.cleanup();
  if (cleanupResult.isErr()) {
    if (operationError) {
      return err(new AggregateError([operationError, cleanupResult.error], 'Price provider runtime operation failed'));
    }

    return err(cleanupResult.error);
  }

  if (operationError) {
    return err(operationError);
  }

  return ok(value as T);
}

export async function withCliPriceProviderRuntimeResult<T>(
  options: CliPriceProviderRuntimeOptions | undefined,
  operation: (runtime: IPriceProviderRuntime) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return withCliPriceProviderRuntime(options, async (runtime) => {
    const operationResult = await operation(runtime);
    if (operationResult.isErr()) {
      throw operationResult.error;
    }

    return operationResult.value;
  });
}

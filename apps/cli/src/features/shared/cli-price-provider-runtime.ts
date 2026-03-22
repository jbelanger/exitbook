import type { IHistoricalAssetPriceSource, PriceEvent } from '@exitbook/accounting';
import { err, ok, type Result } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';
import {
  createPriceProviderRuntime,
  type PriceProviderEvent,
  type PriceProviderRuntime,
} from '@exitbook/price-providers';

import { getDataDir } from './data-dir.js';

export interface CliPriceProviderRuntimeOptions {
  dataDir?: string | undefined;
  eventBus?: EventBus<PriceEvent> | undefined;
  instrumentation?: InstrumentationCollector | undefined;
}

export interface OpenedCliPriceProviderRuntime extends PriceProviderRuntime {
  historicalAssetPriceSource: IHistoricalAssetPriceSource;
}

export async function openCliPriceProviderRuntime(
  options?: CliPriceProviderRuntimeOptions
): Promise<Result<OpenedCliPriceProviderRuntime, Error>> {
  const runtimeResult = await createPriceProviderRuntime({
    dataDir: options?.dataDir ?? getDataDir(),
    providers: {
      coingecko: {
        apiKey: process.env['COINGECKO_API_KEY'],
        useProApi: process.env['COINGECKO_USE_PRO_API'] === 'true',
      },
      cryptocompare: {
        apiKey: process.env['CRYPTOCOMPARE_API_KEY'],
      },
    },
    instrumentation: options?.instrumentation,
    // PriceEvent is a superset of PriceProviderEvent; cast is safe because the
    // price-providers package only ever calls bus.emit(PriceProviderEvent)
    eventBus: options?.eventBus as EventBus<PriceProviderEvent> | undefined,
  });
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  return ok({
    ...runtimeResult.value,
    historicalAssetPriceSource: runtimeResult.value as IHistoricalAssetPriceSource,
  });
}

export async function withCliPriceProviderRuntime<T>(
  options: CliPriceProviderRuntimeOptions | undefined,
  operation: (runtime: OpenedCliPriceProviderRuntime) => Promise<T>
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
  operation: (runtime: OpenedCliPriceProviderRuntime) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return withCliPriceProviderRuntime(options, async (runtime) => {
    const operationResult = await operation(runtime);
    if (operationResult.isErr()) {
      throw operationResult.error;
    }

    return operationResult.value;
  });
}

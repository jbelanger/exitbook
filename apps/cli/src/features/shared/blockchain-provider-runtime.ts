import {
  createBlockchainProviderRuntime,
  loadBlockchainExplorerConfig,
  type BlockchainExplorersConfig,
  type IBlockchainProviderRuntime,
  type ProviderEvent,
} from '@exitbook/blockchain-providers';
import type { EventBus } from '@exitbook/events';
import { err, ok, type Result } from '@exitbook/foundation';
import type { InstrumentationCollector } from '@exitbook/observability';

import { getDataDir } from './data-dir.js';

export interface CliBlockchainProviderRuntimeOptions {
  dataDir?: string | undefined;
  eventBus?: EventBus<ProviderEvent> | undefined;
  explorerConfig?: BlockchainExplorersConfig | undefined;
  instrumentation?: InstrumentationCollector | undefined;
}

export type OpenedCliBlockchainProviderRuntime = IBlockchainProviderRuntime;

export async function openCliBlockchainProviderRuntime(
  options?: CliBlockchainProviderRuntimeOptions
): Promise<Result<OpenedCliBlockchainProviderRuntime, Error>> {
  let explorerConfig = options?.explorerConfig;
  if (explorerConfig === undefined) {
    const explorerConfigResult = loadBlockchainExplorerConfig();
    if (explorerConfigResult.isErr()) {
      return err(explorerConfigResult.error);
    }

    explorerConfig = explorerConfigResult.value;
  }

  const runtimeResult = await createBlockchainProviderRuntime({
    dataDir: options?.dataDir ?? getDataDir(),
    explorerConfig,
    instrumentation: options?.instrumentation,
    eventBus: options?.eventBus,
  });
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  return ok(runtimeResult.value);
}

export async function withCliBlockchainProviderRuntime<T>(
  options: CliBlockchainProviderRuntimeOptions | undefined,
  operation: (runtime: OpenedCliBlockchainProviderRuntime) => Promise<T>
): Promise<Result<T, Error>> {
  const runtimeResult = await openCliBlockchainProviderRuntime(options);
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  const runtime = runtimeResult.value;

  let value: T | undefined;
  let operationError: Error | undefined;

  try {
    value = await operation(runtime);
  } catch (error) {
    operationError = error instanceof Error ? error : new Error(String(error));
  }

  const cleanupResult = await runtime.cleanup();
  if (cleanupResult.isErr()) {
    if (operationError) {
      return err(
        new AggregateError([operationError, cleanupResult.error], 'Blockchain provider runtime operation failed')
      );
    }

    return err(cleanupResult.error);
  }

  if (operationError) {
    return err(operationError);
  }

  return ok(value as T);
}

export async function withCliBlockchainProviderRuntimeResult<T>(
  options: CliBlockchainProviderRuntimeOptions | undefined,
  operation: (runtime: OpenedCliBlockchainProviderRuntime) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return withCliBlockchainProviderRuntime(options, async (runtime) => {
    const operationResult = await operation(runtime);
    if (operationResult.isErr()) {
      throw operationResult.error;
    }

    return operationResult.value;
  });
}

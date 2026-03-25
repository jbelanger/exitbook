import {
  createBlockchainProviderRuntime,
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
  const runtimeResult = await createBlockchainProviderRuntime({
    dataDir: options?.dataDir ?? getDataDir(),
    explorerConfig: options?.explorerConfig,
    instrumentation: options?.instrumentation,
    eventBus: options?.eventBus,
  });
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  return ok(runtimeResult.value);
}

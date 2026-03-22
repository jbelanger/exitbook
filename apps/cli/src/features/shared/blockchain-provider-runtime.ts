import {
  createBlockchainProviderRuntime,
  type BlockchainProviderRuntime,
  type BlockchainExplorersConfig,
  loadBlockchainExplorerConfig,
  type ProviderEvent,
} from '@exitbook/blockchain-providers';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';

import { getDataDir } from './data-dir.js';

export type OpenedBlockchainProviderRuntime = BlockchainProviderRuntime;

export async function openBlockchainProviderRuntime(
  config?: BlockchainExplorersConfig,
  options?: {
    dataDir?: string | undefined;
    eventBus?: EventBus<ProviderEvent> | undefined;
    instrumentation?: InstrumentationCollector | undefined;
  }
): Promise<OpenedBlockchainProviderRuntime> {
  let explorerConfig = config;
  if (explorerConfig === undefined) {
    const explorerConfigResult = loadBlockchainExplorerConfig();
    if (explorerConfigResult.isOk()) {
      explorerConfig = explorerConfigResult.value;
    } else {
      throw explorerConfigResult.error;
    }
  }

  const runtimeResult = await createBlockchainProviderRuntime({
    dataDir: options?.dataDir ?? getDataDir(),
    explorerConfig,
    instrumentation: options?.instrumentation,
    eventBus: options?.eventBus,
  });
  if (runtimeResult.isErr()) {
    throw runtimeResult.error;
  }

  return runtimeResult.value;
}

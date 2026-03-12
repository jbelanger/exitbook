import {
  createBlockchainProviderRuntime,
  type BlockchainExplorersConfig,
  type BlockchainProviderManager,
  type ProviderEvent,
} from '@exitbook/blockchain-providers';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';

import { getDataDir } from './data-dir.js';

export interface OpenedBlockchainProviderRuntime {
  providerManager: BlockchainProviderManager;
  cleanup: () => Promise<void>;
}

export async function openBlockchainProviderRuntime(
  config?: BlockchainExplorersConfig,
  options?: {
    dataDir?: string | undefined;
    eventBus?: EventBus<ProviderEvent> | undefined;
    instrumentation?: InstrumentationCollector | undefined;
  }
): Promise<OpenedBlockchainProviderRuntime> {
  const runtimeResult = await createBlockchainProviderRuntime({
    dataDir: options?.dataDir ?? getDataDir(),
    explorerConfig: config,
    instrumentation: options?.instrumentation,
    eventBus: options?.eventBus,
  });
  if (runtimeResult.isErr()) {
    throw runtimeResult.error;
  }

  return runtimeResult.value;
}

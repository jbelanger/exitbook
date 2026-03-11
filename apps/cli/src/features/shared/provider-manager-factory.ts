/**
 * Factory for creating a BlockchainProviderManager with persistent stats
 *
 * Encapsulates providers.db creation, migration, and wiring so that
 * each CLI entry point doesn't duplicate this logic.
 */

import {
  createBlockchainProviderRuntime,
  type BlockchainExplorersConfig,
  type BlockchainProviderManager,
  type ProviderEvent,
} from '@exitbook/blockchain-providers';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/observability';

import { getDataDir } from './data-dir.js';

export interface ProviderManagerWithStats {
  providerManager: BlockchainProviderManager;
  cleanup: () => Promise<void>;
}

/**
 * Create a BlockchainProviderManager with persistent stats DB wired up.
 *
 * If the stats DB fails to initialize, the manager runs without persistence
 * (graceful degradation).
 */
export async function createProviderManagerWithStats(
  config?: BlockchainExplorersConfig,
  options?: {
    dataDir?: string | undefined;
    eventBus?: EventBus<ProviderEvent> | undefined;
    instrumentation?: InstrumentationCollector | undefined;
  }
): Promise<ProviderManagerWithStats> {
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

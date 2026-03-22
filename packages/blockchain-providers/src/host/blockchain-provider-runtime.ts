import type { EventBus } from '@exitbook/events';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';

import { type ProviderEvent } from '../events.js';
import { createProviderRegistry } from '../initialize.js';
import { initProviderStatsPersistence, type ProviderStatsPersistence } from '../provider-stats/persistence/runtime.js';
import { BlockchainProviderManager } from '../runtime/manager/provider-manager.js';
import { initTokenMetadataPersistence, type TokenMetadataPersistence } from '../token-metadata/persistence/runtime.js';

import { loadExplorerConfig, type BlockchainExplorersConfig } from './explorer-config.js';

const logger = getLogger('BlockchainProviderRuntime');

export interface BlockchainProviderRuntimeOptions {
  dataDir: string;
  eventBus?: EventBus<ProviderEvent> | undefined;
  explorerConfig?: BlockchainExplorersConfig | undefined;
  instrumentation?: InstrumentationCollector | undefined;
}

export interface BlockchainProviderRuntime {
  providerManager: BlockchainProviderManager;
  cleanup(): Promise<void>;
}

export async function createBlockchainProviderRuntime(
  options: BlockchainProviderRuntimeOptions
): Promise<Result<BlockchainProviderRuntime, Error>> {
  const explorerConfig = options.explorerConfig ?? loadExplorerConfig();

  let providerStatsPersistence: ProviderStatsPersistence | undefined;
  const providerStatsResult = await initProviderStatsPersistence(options.dataDir);
  if (providerStatsResult.isOk()) {
    providerStatsPersistence = providerStatsResult.value;
  } else {
    logger.warn(
      { error: providerStatsResult.error },
      'Failed to create provider stats database. Running without persistence.'
    );
  }

  let tokenMetadataPersistence: TokenMetadataPersistence | undefined;
  const tokenMetadataResult = await initTokenMetadataPersistence(options.dataDir);
  if (tokenMetadataResult.isOk()) {
    tokenMetadataPersistence = tokenMetadataResult.value;
  } else {
    logger.warn(
      { error: tokenMetadataResult.error },
      'Failed to initialize token metadata persistence. Running without token metadata cache.'
    );
  }

  let providerManager: BlockchainProviderManager | undefined;

  try {
    providerManager = new BlockchainProviderManager(createProviderRegistry(), {
      explorerConfig,
      statsQueries: providerStatsPersistence?.queries,
      tokenMetadataQueries: tokenMetadataPersistence?.queries,
      instrumentation: options.instrumentation,
      eventBus: options.eventBus,
    });
    const readyProviderManager = providerManager;
    readyProviderManager.startBackgroundTasks();

    if (providerStatsPersistence?.queries) {
      await readyProviderManager.loadPersistedStats();
    }

    return ok({
      providerManager: readyProviderManager,
      async cleanup() {
        try {
          await readyProviderManager.destroy();
        } finally {
          if (tokenMetadataPersistence) {
            await tokenMetadataPersistence.cleanup().catch((error: unknown) => {
              logger.warn({ error }, 'Failed to close token metadata persistence during cleanup');
            });
          }

          if (providerStatsPersistence) {
            await providerStatsPersistence.cleanup().catch((error: unknown) => {
              logger.warn({ error }, 'Failed to close provider stats persistence during cleanup');
            });
          }
        }
      },
    });
  } catch (error) {
    if (providerManager) {
      await providerManager.destroy().catch((destroyError: unknown) => {
        logger.warn({ error: destroyError }, 'Failed to destroy provider manager after initialization failure');
      });
    }

    if (tokenMetadataPersistence) {
      await tokenMetadataPersistence.cleanup().catch((cleanupError: unknown) => {
        logger.warn(
          { error: cleanupError },
          'Failed to cleanup token metadata persistence after initialization failure'
        );
      });
    }

    if (providerStatsPersistence) {
      await providerStatsPersistence.cleanup().catch((cleanupError: unknown) => {
        logger.warn(
          { error: cleanupError },
          'Failed to cleanup provider stats persistence after initialization failure'
        );
      });
    }

    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

import path from 'node:path';

import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';

import { BlockchainProviderManager } from '../core/manager/provider-manager.js';
import { loadExplorerConfig, type BlockchainExplorersConfig } from '../core/utils/config-utils.js';
import { type ProviderEvent } from '../events.js';
import { createProviderRegistry } from '../initialize.js';
import { initializeProviderStatsDatabase } from '../persistence/database.js';
import {
  closeProviderStatsDatabase,
  createProviderStatsDatabase,
  createProviderStatsQueries,
  type ProviderStatsDB,
} from '../persistence/index.js';
import {
  createTokenMetadataPersistence,
  type TokenMetadataPersistenceDeps,
} from '../persistence/token-metadata/index.js';

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

  let providerStatsDb: ProviderStatsDB | undefined;
  let statsQueries: ReturnType<typeof createProviderStatsQueries> | undefined;

  const providerStatsResult = createProviderStatsDatabase(path.join(options.dataDir, 'providers.db'));
  if (providerStatsResult.isOk()) {
    providerStatsDb = providerStatsResult.value;
    const migrationResult = await initializeProviderStatsDatabase(providerStatsDb);

    if (migrationResult.isOk()) {
      statsQueries = createProviderStatsQueries(providerStatsDb);
    } else {
      logger.warn({ error: migrationResult.error }, 'Provider stats migration failed. Running without persistence.');
      const closeResult = await closeProviderStatsDatabase(providerStatsDb);
      if (closeResult.isErr()) {
        logger.warn({ error: closeResult.error }, 'Failed to close provider stats database after migration failure');
      }
      providerStatsDb = undefined;
    }
  } else {
    logger.warn(
      { error: providerStatsResult.error },
      'Failed to create provider stats database. Running without persistence.'
    );
  }

  let tokenMetadataPersistence: TokenMetadataPersistenceDeps | undefined;
  const tokenMetadataResult = await createTokenMetadataPersistence(options.dataDir);
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
      statsQueries,
      tokenMetadataQueries: tokenMetadataPersistence?.queries,
      instrumentation: options.instrumentation,
      eventBus: options.eventBus,
    });
    const readyProviderManager = providerManager;
    readyProviderManager.startBackgroundTasks();

    if (statsQueries) {
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

          if (providerStatsDb) {
            const closeResult = await closeProviderStatsDatabase(providerStatsDb);
            if (closeResult.isErr()) {
              logger.warn({ error: closeResult.error }, 'Failed to close provider stats database during cleanup');
            }
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

    if (providerStatsDb) {
      const closeResult = await closeProviderStatsDatabase(providerStatsDb);
      if (closeResult.isErr()) {
        logger.warn(
          { error: closeResult.error },
          'Failed to close provider stats database after initialization failure'
        );
      }
    }

    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

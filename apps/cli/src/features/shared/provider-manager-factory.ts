/**
 * Factory for creating a BlockchainProviderManager with persistent stats
 *
 * Encapsulates providers.db creation, migration, and wiring so that
 * each CLI entry point doesn't duplicate this logic.
 */

import path from 'node:path';

import {
  BlockchainProviderManager,
  closeProviderStatsDatabase,
  closeTokenMetadataDatabase,
  createProviderStatsDatabase,
  createTokenMetadataDatabase,
  initializeProviderStatsDatabase,
  initializeTokenMetadataDatabase,
  createTokenMetadataQueries,
  loadExplorerConfig,
  createProviderStatsQueries,
  type BlockchainExplorersConfig,
  type ProviderEvent,
  type ProviderStatsDB,
  type TokenMetadataDB,
} from '@exitbook/blockchain-providers';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';

import { getDataDir } from './data-dir.js';
import { providerRegistry } from './provider-registry.js';

const logger = getLogger('provider-manager-factory');

export interface ProviderManagerWithStats {
  providerManager: BlockchainProviderManager;
  providerStatsDb: ProviderStatsDB | undefined;
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
    eventBus?: EventBus<ProviderEvent> | undefined;
    instrumentation?: InstrumentationCollector | undefined;
  }
): Promise<ProviderManagerWithStats> {
  const explorerConfig = config ?? loadExplorerConfig();

  // Resolve stats persistence before constructing the manager so statsQueries
  // can be passed via constructor options (no post-construction setter needed).
  let providerStatsDb: ProviderStatsDB | undefined;
  let statsQueries;

  const dataDir = getDataDir();
  const dbResult = createProviderStatsDatabase(path.join(dataDir, 'providers.db'));
  if (dbResult.isOk()) {
    providerStatsDb = dbResult.value;
    const migrationResult = await initializeProviderStatsDatabase(providerStatsDb);

    if (migrationResult.isOk()) {
      statsQueries = createProviderStatsQueries(providerStatsDb);
    } else {
      logger.warn(`Provider stats migration failed: ${migrationResult.error.message}. Running without persistence.`);
      const closeResult = await closeProviderStatsDatabase(providerStatsDb);
      if (closeResult.isErr()) {
        logger.warn(`Failed to close provider stats database after migration failure: ${closeResult.error.message}`);
      }
      providerStatsDb = undefined;
    }
  } else {
    logger.warn(`Failed to create provider stats database: ${dbResult.error.message}. Running without persistence.`);
  }

  // Token metadata cache DB (graceful degradation if unavailable)
  let tokenMetadataDb: TokenMetadataDB | undefined;
  let tokenMetadataQueries;

  const tmDbResult = createTokenMetadataDatabase(path.join(dataDir, 'token-metadata.db'));
  if (tmDbResult.isOk()) {
    tokenMetadataDb = tmDbResult.value;
    const tmMigrationResult = await initializeTokenMetadataDatabase(tokenMetadataDb);
    if (tmMigrationResult.isOk()) {
      tokenMetadataQueries = createTokenMetadataQueries(tokenMetadataDb);
    } else {
      logger.warn(
        `Token metadata migration failed: ${tmMigrationResult.error.message}. Running without token metadata cache.`
      );
      await closeTokenMetadataDatabase(tokenMetadataDb).catch(() => {
        /* empty */
      });
      tokenMetadataDb = undefined;
    }
  } else {
    logger.warn(
      `Failed to create token metadata database: ${tmDbResult.error.message}. Running without token metadata cache.`
    );
  }

  const providerManager = new BlockchainProviderManager(providerRegistry, {
    explorerConfig,
    statsQueries,
    tokenMetadataQueries,
    instrumentation: options?.instrumentation,
    eventBus: options?.eventBus,
  });
  providerManager.startBackgroundTasks();
  if (statsQueries) {
    await providerManager.loadPersistedStats();
  }

  const cleanup = async () => {
    try {
      await providerManager.destroy();
    } finally {
      if (tokenMetadataDb) {
        const tmCloseResult = await closeTokenMetadataDatabase(tokenMetadataDb);
        if (tmCloseResult.isErr()) {
          logger.warn(`Failed to close token metadata database during cleanup: ${tmCloseResult.error.message}`);
        }
      }
      if (providerStatsDb) {
        const closeResult = await closeProviderStatsDatabase(providerStatsDb);
        if (closeResult.isErr()) {
          logger.warn(`Failed to close provider stats database during cleanup: ${closeResult.error.message}`);
        }
      }
    }
  };

  return { providerManager, providerStatsDb, cleanup };
}

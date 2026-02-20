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
  createProviderStatsDatabase,
  initializeProviderStatsDatabase,
  loadExplorerConfig,
  createProviderStatsQueries,
  type BlockchainExplorersConfig,
  type ProviderStatsDB,
} from '@exitbook/blockchain-providers';
import { getLogger } from '@exitbook/logger';

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
  config?: BlockchainExplorersConfig
): Promise<ProviderManagerWithStats> {
  const explorerConfig = config ?? loadExplorerConfig();
  const providerManager = new BlockchainProviderManager(providerRegistry, { explorerConfig });
  providerManager.startBackgroundTasks();

  let providerStatsDb: ProviderStatsDB | undefined;

  // Try to set up persistence — graceful degradation on failure
  const dataDir = getDataDir();
  const dbResult = createProviderStatsDatabase(path.join(dataDir, 'providers.db'));
  if (dbResult.isOk()) {
    providerStatsDb = dbResult.value;
    const migrationResult = await initializeProviderStatsDatabase(providerStatsDb);

    if (migrationResult.isOk()) {
      const statsQueries = createProviderStatsQueries(providerStatsDb);
      providerManager.setStatsQueries(statsQueries);
      await providerManager.loadPersistedStats();
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

  const cleanup = async () => {
    try {
      await providerManager.destroy();
    } finally {
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

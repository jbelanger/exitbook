import path from 'node:path';

import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { ProviderInfo } from '../core/types/registry.js';
import { loadExplorerConfig, type BlockchainExplorersConfig } from '../core/utils/config-utils.js';
import { createProviderRegistry } from '../initialize.js';
import { initializeProviderStatsDatabase } from '../persistence/database.js';
import {
  closeProviderStatsDatabase,
  createProviderStatsDatabase,
  createProviderStatsQueries,
  type ProviderStatsRow,
} from '../persistence/index.js';

const logger = getLogger('BlockchainProviderCatalog');

export interface ProviderCatalogEntry extends ProviderInfo {
  apiKeyEnvVar?: string | undefined;
}

export interface BlockchainProviderCatalog {
  explorerConfig?: BlockchainExplorersConfig | undefined;
  providerStats: ProviderStatsRow[];
  providers: ProviderCatalogEntry[];
}

export async function loadBlockchainProviderCatalog(
  dataDir: string
): Promise<Result<BlockchainProviderCatalog, Error>> {
  let explorerConfig: BlockchainExplorersConfig | undefined;

  try {
    explorerConfig = loadExplorerConfig();
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }

  const registry = createProviderRegistry();
  const providers = registry.getAllProviders().map((provider) => ({
    ...provider,
    apiKeyEnvVar: registry.getMetadata(provider.blockchain, provider.name)?.apiKeyEnvVar ?? undefined,
  }));

  let providerStats: ProviderStatsRow[] = [];
  const dbResult = createProviderStatsDatabase(path.join(dataDir, 'providers.db'));
  if (dbResult.isOk()) {
    const db = dbResult.value;
    const migrationResult = await initializeProviderStatsDatabase(db);

    if (migrationResult.isOk()) {
      const statsQueries = createProviderStatsQueries(db);
      const statsResult = await statsQueries.getAll();
      if (statsResult.isOk()) {
        providerStats = statsResult.value;
      } else {
        logger.warn({ error: statsResult.error }, 'Failed to load provider stats. Continuing without stats.');
      }
    } else {
      logger.warn({ error: migrationResult.error }, 'Provider stats migration failed. Continuing without stats.');
    }

    const closeResult = await closeProviderStatsDatabase(db);
    if (closeResult.isErr()) {
      logger.warn({ error: closeResult.error }, 'Failed to close provider stats database after catalog load');
    }
  } else {
    logger.warn({ error: dbResult.error }, 'Failed to open provider stats database. Continuing without stats.');
  }

  return ok({
    explorerConfig,
    providerStats,
    providers,
  });
}

import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { ProviderInfo } from '../contracts/registry.js';
import { createProviderRegistry } from '../initialize.js';
import type { ProviderStatsSnapshot } from '../provider-stats/index.js';
import { initProviderStatsPersistence } from '../provider-stats/persistence/runtime.js';
import { toProviderStatsSnapshot } from '../provider-stats/snapshot.js';

import { loadExplorerConfig, type BlockchainExplorersConfig } from './load-explorer-config.js';

const logger = getLogger('BlockchainProviderCatalog');

export interface ProviderCatalogEntry extends ProviderInfo {
  apiKeyEnvVar?: string | undefined;
}

export interface BlockchainProviderCatalog {
  explorerConfig?: BlockchainExplorersConfig | undefined;
  providerStats: ProviderStatsSnapshot[];
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

  let providerStats: ProviderStatsSnapshot[] = [];
  const persistenceResult = await initProviderStatsPersistence(dataDir);
  if (persistenceResult.isOk()) {
    const statsResult = await persistenceResult.value.queries.getAll();
    if (statsResult.isOk()) {
      providerStats = statsResult.value.map(toProviderStatsSnapshot);
    } else {
      logger.warn({ error: statsResult.error }, 'Failed to load provider stats. Continuing without stats.');
    }

    await persistenceResult.value.cleanup().catch((error: unknown) => {
      logger.warn({ error }, 'Failed to close provider stats persistence after catalog load');
    });
  } else {
    logger.warn(
      { error: persistenceResult.error },
      'Failed to open provider stats database. Continuing without stats.'
    );
  }

  return ok({
    explorerConfig,
    providerStats,
    providers,
  });
}

// Tier 1 handler for providers view command
import path from 'node:path';

import {
  closeProviderStatsDatabase,
  createProviderStatsDatabase,
  createProviderStatsQueries,
  initializeProviderStatsDatabase,
  loadExplorerConfig,
  type ProviderStatsRow,
} from '@exitbook/blockchain-providers';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

import { providerRegistry } from '../shared/provider-registry.js';

import type { ProviderViewItem } from './components/index.js';
import {
  buildProviderMap,
  filterProviders,
  mergeProviderData,
  sortProviders,
  type HealthFilter,
} from './providers-view-utils.js';

const logger = getLogger('ProvidersViewHandler');

export interface ProvidersViewParams {
  blockchain?: string | undefined;
  health?: HealthFilter | undefined;
  missingApiKey?: boolean | undefined;
}

/**
 * Tier 1 handler for `providers view`.
 * Loads provider data from registry + stats DB; testable with mock registry.
 */
export class ProvidersViewHandler {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly dataDir: string
  ) {}

  async execute(params: ProvidersViewParams): Promise<ProviderViewItem[]> {
    const allBlockchains = this.registry.getAllBlockchains();
    const providerMap = buildProviderMap(allBlockchains, (blockchain) => providerRegistry.getAvailable(blockchain));

    const explorerConfig = loadExplorerConfig();

    let allStatsRows: ProviderStatsRow[] = [];
    const dbResult = createProviderStatsDatabase(path.join(this.dataDir, 'providers.db'));

    if (dbResult.isOk()) {
      const db = dbResult.value;
      const migrationResult = await initializeProviderStatsDatabase(db);

      if (migrationResult.isOk()) {
        const statsQueries = createProviderStatsQueries(db);
        const statsResult = await statsQueries.getAll();
        if (statsResult.isOk()) {
          allStatsRows = statsResult.value;
        } else {
          logger.warn(`Failed to load provider stats: ${statsResult.error.message}`);
        }
      } else {
        logger.warn(`Provider stats migration failed: ${migrationResult.error.message}. Showing without stats.`);
      }

      const closeResult = await closeProviderStatsDatabase(db);
      if (closeResult.isErr()) {
        logger.warn(`Failed to close provider stats database: ${closeResult.error.message}`);
      }
    } else {
      logger.warn(`Failed to open provider stats database: ${dbResult.error.message}. Showing without stats.`);
    }

    let items = mergeProviderData(providerMap, allStatsRows, explorerConfig);

    items = filterProviders(items, {
      blockchain: params.blockchain,
      health: params.health,
      missingApiKey: params.missingApiKey,
    });

    items = sortProviders(items);

    return items;
  }
}

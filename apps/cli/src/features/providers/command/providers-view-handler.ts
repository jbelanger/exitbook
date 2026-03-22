import {
  listBlockchainProviders,
  loadBlockchainExplorerConfig,
  loadBlockchainProviderHealthStats,
} from '@exitbook/blockchain-providers';

import type { ProviderViewItem } from '../view/index.js';

import {
  buildProviderViewItems,
  filterProviders,
  groupProvidersByName,
  sortProviders,
  type HealthFilter,
} from './providers-view-utils.js';

interface ProvidersViewParams {
  blockchain?: string | undefined;
  health?: HealthFilter | undefined;
  missingApiKey?: boolean | undefined;
}

/**
 * Tier 1 handler for `providers view`.
 * Loads provider data from registry + stats DB; testable with mock registry.
 */
export class ProvidersViewHandler {
  constructor(private readonly dataDir: string) {}

  async execute(params: ProvidersViewParams): Promise<ProviderViewItem[]> {
    const explorerConfigResult = loadBlockchainExplorerConfig();
    if (explorerConfigResult.isErr()) {
      throw explorerConfigResult.error;
    }

    const providerStatsResult = await loadBlockchainProviderHealthStats(this.dataDir);
    if (providerStatsResult.isErr()) {
      throw providerStatsResult.error;
    }

    const providerMap = groupProvidersByName(listBlockchainProviders());

    let items = buildProviderViewItems(providerMap, providerStatsResult.value, explorerConfigResult.value);

    items = filterProviders(items, {
      blockchain: params.blockchain,
      health: params.health,
      missingApiKey: params.missingApiKey,
    });

    items = sortProviders(items);

    return items;
  }
}

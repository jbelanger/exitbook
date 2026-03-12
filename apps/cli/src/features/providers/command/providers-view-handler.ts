import { loadBlockchainProviderCatalog } from '@exitbook/blockchain-providers';

import type { ProviderViewItem } from '../view/index.js';

import {
  buildProviderViewItems,
  filterProviders,
  groupProvidersByName,
  sortProviders,
  type HealthFilter,
} from './providers-view-utils.js';

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
  constructor(private readonly dataDir: string) {}

  async execute(params: ProvidersViewParams): Promise<ProviderViewItem[]> {
    const catalogResult = await loadBlockchainProviderCatalog(this.dataDir);
    if (catalogResult.isErr()) {
      throw catalogResult.error;
    }

    const providerCatalog = catalogResult.value;
    const providerMap = groupProvidersByName(providerCatalog.providers);

    let items = buildProviderViewItems(providerMap, providerCatalog.providerStats, providerCatalog.explorerConfig);

    items = filterProviders(items, {
      blockchain: params.blockchain,
      health: params.health,
      missingApiKey: params.missingApiKey,
    });

    items = sortProviders(items);

    return items;
  }
}

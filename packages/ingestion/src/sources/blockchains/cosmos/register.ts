import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { COSMOS_CHAINS, getCosmosChainConfig } from '@exitbook/blockchain-providers';

import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { normalizeCosmosAddress } from './address-utils.js';
import { CosmosImporter } from './importer.js';
import { CosmosProcessor } from './processor.js';

export function registerCosmosChains(): void {
  for (const chainName of Object.keys(COSMOS_CHAINS)) {
    const config = getCosmosChainConfig(chainName);
    if (!config) continue;

    registerBlockchain({
      blockchain: chainName,
      chainModel: 'account-based',

      normalizeAddress: (address: string) => normalizeCosmosAddress(address, chainName),

      createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
        new CosmosImporter(config, providerManager, {
          preferredProvider: providerName,
        }),

      createProcessor: ({ scamDetectionService }) => new CosmosProcessor(config, scamDetectionService),
    });
  }
}

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { getSubstrateChainConfig, SUBSTRATE_CHAINS } from '@exitbook/blockchain-providers';

import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { normalizeSubstrateAddress } from './address-utils.js';
import { SubstrateImporter } from './importer.js';
import { SubstrateProcessor } from './processor.js';

export function registerSubstrateChains(): void {
  for (const chainName of Object.keys(SUBSTRATE_CHAINS)) {
    const config = getSubstrateChainConfig(chainName);
    if (!config) continue;

    registerBlockchain({
      blockchain: chainName,
      chainModel: 'account-based',

      normalizeAddress: (address: string) => normalizeSubstrateAddress(address, chainName),

      createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
        new SubstrateImporter(config, providerManager, {
          preferredProvider: providerName,
        }),

      createProcessor: ({ scamDetectionService }) => new SubstrateProcessor(config, scamDetectionService),
    });
  }
}

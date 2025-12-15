import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { getSubstrateChainConfig, SUBSTRATE_CHAINS } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../core/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../shared/blockchain-adapter.ts';

import { SubstrateImporter } from './importer.js';
import { SubstrateProcessor } from './processor.js';

// Register all Substrate chains from the chain registry
for (const chainName of Object.keys(SUBSTRATE_CHAINS)) {
  const config = getSubstrateChainConfig(chainName);
  if (!config) continue;

  registerBlockchain({
    blockchain: chainName,

    normalizeAddress: (address: string) => {
      // Substrate addresses use SS58 format - case-sensitive
      if (!/^[1-9A-HJ-NP-Za-km-z]{46,48}$/.test(address)) {
        return err(new Error(`Invalid Substrate address format for ${chainName}: ${address}`));
      }
      return ok(address);
    },

    createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
      new SubstrateImporter(config, providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new SubstrateProcessor(config)),
  });
}

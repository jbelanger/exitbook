import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { COSMOS_CHAINS, getCosmosChainConfig } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../shared/blockchain-adapter.ts';

import { CosmosImporter } from './importer.js';
import { CosmosProcessor } from './processor.js';

// Register all Cosmos SDK chains from the chain registry
for (const chainName of Object.keys(COSMOS_CHAINS)) {
  const config = getCosmosChainConfig(chainName);
  if (!config) continue;

  registerBlockchain({
    blockchain: chainName,

    normalizeAddress: (address: string) => {
      // Cosmos addresses use bech32 format - case-sensitive
      // Format: <prefix>1<data> (e.g., inj1..., cosmos1..., osmo1...)
      if (!/^[a-z]+1[a-z0-9]{38,58}$/.test(address)) {
        return err(new Error(`Invalid Cosmos address format for ${chainName}: ${address}`));
      }
      return ok(address);
    },

    createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
      new CosmosImporter(config, providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new CosmosProcessor(config)),
  });
}

import type { BlockchainProviderManager } from '@exitbook/providers';
import { COSMOS_CHAINS, getCosmosChainConfig } from '@exitbook/providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import { registerBlockchain } from '../shared/blockchain-config.ts';

import { CosmosImporter } from './importer.ts';
import { CosmosProcessor } from './processor.ts';

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

    createImporter: (providerManager: BlockchainProviderManager, providerId?: string) =>
      new CosmosImporter(config, providerManager, {
        preferredProvider: providerId,
      }),

    createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new CosmosProcessor(config)),
  });
}

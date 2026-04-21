import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { COSMOS_CHAINS, getCosmosChainConfig } from '@exitbook/blockchain-providers/cosmos';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeCosmosAddress } from './address-utils.js';
import { CosmosImporter } from './importer.js';
import { CosmosProcessor } from './processor.js';

export const cosmosAdapters: BlockchainAdapter[] = Object.keys(COSMOS_CHAINS).flatMap((chainName) => {
  const config = getCosmosChainConfig(chainName);
  if (!config) return [];

  const adapter: BlockchainAdapter = {
    blockchain: chainName,
    chainModel: 'account-based',

    normalizeAddress: (address: string) => normalizeCosmosAddress(address, chainName),

    createImporter: (providerRuntime: IBlockchainProviderRuntime, providerName?: string) =>
      new CosmosImporter(config, providerRuntime, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ scamDetector }) => new CosmosProcessor(config, scamDetector),
  };

  return [adapter];
});

import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { getSubstrateChainConfig, SUBSTRATE_CHAINS } from '@exitbook/blockchain-providers/substrate';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeSubstrateAddress } from './address-utils.js';
import { SubstrateImporter } from './importer.js';
import { SubstrateProcessor } from './processor.js';

export const substrateAdapters: BlockchainAdapter[] = Object.keys(SUBSTRATE_CHAINS).flatMap((chainName) => {
  const config = getSubstrateChainConfig(chainName);
  if (!config) return [];

  const adapter: BlockchainAdapter = {
    blockchain: chainName,
    chainModel: 'account-based',

    normalizeAddress: (address: string) => normalizeSubstrateAddress(address, chainName),

    createImporter: (providerRuntime: IBlockchainProviderRuntime, providerName?: string) =>
      new SubstrateImporter(config, providerRuntime, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ scamDetectionService }) => new SubstrateProcessor(config, scamDetectionService),
  };

  return [adapter];
});

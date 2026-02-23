import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { EVM_CHAINS, getEvmChainConfig } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeEvmAddress } from './address-utils.js';
import { EvmImporter } from './importer.js';
import { EvmTransactionProcessor } from './processor.js';

export const evmAdapters: BlockchainAdapter[] = Object.keys(EVM_CHAINS).flatMap((chainName) => {
  const config = getEvmChainConfig(chainName);
  if (!config) return [];

  const adapter: BlockchainAdapter = {
    blockchain: chainName,
    chainModel: 'account-based',

    normalizeAddress: (address: string) => normalizeEvmAddress(address, chainName),

    createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
      new EvmImporter(config, providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ providerManager, tokenMetadataService, scamDetectionService }) =>
      new EvmTransactionProcessor(config, providerManager, tokenMetadataService, scamDetectionService),
  };

  return [adapter];
});

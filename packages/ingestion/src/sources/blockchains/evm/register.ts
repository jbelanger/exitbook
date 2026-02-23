import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { EVM_CHAINS, getEvmChainConfig } from '@exitbook/blockchain-providers';

import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { normalizeEvmAddress } from './address-utils.js';
import { EvmImporter } from './importer.js';
import { EvmTransactionProcessor } from './processor.js';

export function registerEvmChains(): void {
  for (const chainName of Object.keys(EVM_CHAINS)) {
    const config = getEvmChainConfig(chainName);
    if (!config) continue;

    registerBlockchain({
      blockchain: chainName,
      chainModel: 'account-based',

      normalizeAddress: (address: string) => normalizeEvmAddress(address, chainName),

      createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
        new EvmImporter(config, providerManager, {
          preferredProvider: providerName,
        }),

      createProcessor: ({ providerManager, tokenMetadataService, scamDetectionService }) =>
        new EvmTransactionProcessor(config, providerManager, tokenMetadataService, scamDetectionService),
    });
  }
}

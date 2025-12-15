import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { EVM_CHAINS, getEvmChainConfig, normalizeEvmAddress } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../core/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../../../core/types/blockchain-adapter.ts';

import { EvmImporter } from './importer.js';
import { EvmTransactionProcessor } from './processor.js';

// Register all EVM chains from the chain registry
for (const chainName of Object.keys(EVM_CHAINS)) {
  const config = getEvmChainConfig(chainName);
  if (!config) continue;

  registerBlockchain({
    blockchain: chainName,

    normalizeAddress: (address: string) => {
      // Use centralized normalization logic
      const normalized = normalizeEvmAddress(address);
      if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
        return err(new Error(`Invalid EVM address format for ${chainName}: ${address}`));
      }
      return ok(normalized);
    },

    createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
      new EvmImporter(config, providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: (tokenMetadataService?: ITokenMetadataService) => {
      if (!tokenMetadataService) {
        return err(new Error('TokenMetadataService is required for EVM processor'));
      }
      return ok(new EvmTransactionProcessor(config, tokenMetadataService));
    },
  });
}

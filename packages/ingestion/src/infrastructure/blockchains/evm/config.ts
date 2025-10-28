import type { BlockchainProviderManager } from '@exitbook/providers';
import { EVM_CHAINS, getEvmChainConfig } from '@exitbook/providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import { registerBlockchain } from '../shared/blockchain-config.ts';

import { EvmImporter } from './importer.ts';
import { EvmTransactionProcessor } from './processor.ts';

// Register all EVM chains from the chain registry
for (const chainName of Object.keys(EVM_CHAINS)) {
  const config = getEvmChainConfig(chainName);
  if (!config) continue;

  registerBlockchain({
    blockchain: chainName,

    normalizeAddress: (address: string) => {
      const normalized = address.toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
        return err(new Error(`Invalid EVM address format for ${chainName}: ${address}`));
      }
      return ok(normalized);
    },

    createImporter: (providerManager: BlockchainProviderManager, providerId?: string) =>
      new EvmImporter(config, providerManager, {
        preferredProvider: providerId,
      }),

    createProcessor: (tokenMetadataService?: ITokenMetadataService) => {
      if (!tokenMetadataService) {
        return err(new Error('TokenMetadataService is required for EVM processor'));
      }
      return ok(new EvmTransactionProcessor(config, tokenMetadataService));
    },
  });
}

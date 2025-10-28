import type { BlockchainProviderManager } from '@exitbook/providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.ts';
import { registerBlockchain } from '../shared/blockchain-config.ts';

import { SolanaTransactionImporter } from './importer.ts';
import { SolanaTransactionProcessor } from './processor.ts';

registerBlockchain({
  blockchain: 'solana',

  normalizeAddress: (address: string) => {
    // Solana addresses are case-sensitive base58 - do NOT lowercase
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return err(new Error(`Invalid Solana address format: ${address}`));
    }
    return ok(address);
  },

  createImporter: (providerManager: BlockchainProviderManager, providerId?: string) =>
    new SolanaTransactionImporter(providerManager, {
      preferredProvider: providerId,
    }),

  createProcessor: (tokenMetadataService?: ITokenMetadataService) => {
    if (!tokenMetadataService) {
      return err(new Error('TokenMetadataService is required for Solana processor'));
    }
    return ok(new SolanaTransactionProcessor(tokenMetadataService));
  },
});

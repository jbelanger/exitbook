import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';

import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { normalizeSolanaAddress } from './address-utils.js';
import { SolanaTransactionImporter } from './importer.js';
import { SolanaTransactionProcessor } from './processor.js';

export function registerSolanaChain(): void {
  registerBlockchain({
    blockchain: 'solana',
    chainModel: 'account-based',

    normalizeAddress: (address: string) => normalizeSolanaAddress(address),

    createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
      new SolanaTransactionImporter(providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ tokenMetadataService, scamDetectionService }) =>
      new SolanaTransactionProcessor(tokenMetadataService, scamDetectionService),
  });
}

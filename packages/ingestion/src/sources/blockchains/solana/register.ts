import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeSolanaAddress } from './address-utils.js';
import { SolanaTransactionImporter } from './importer.js';
import { SolanaTransactionProcessor } from './processor.js';

export const solanaAdapter: BlockchainAdapter = {
  blockchain: 'solana',
  chainModel: 'account-based',

  normalizeAddress: (address: string) => normalizeSolanaAddress(address),

  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
    new SolanaTransactionImporter(providerManager, {
      preferredProvider: providerName,
    }),

  createProcessor: ({ tokenMetadataService, scamDetectionService }) =>
    new SolanaTransactionProcessor(tokenMetadataService, scamDetectionService),
};

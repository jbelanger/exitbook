import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeSolanaAddress } from './address-utils.js';
import { SolanaImporter } from './importer.js';
import { SolanaProcessor } from './processor.js';

export const solanaAdapter: BlockchainAdapter = {
  blockchain: 'solana',
  chainModel: 'account-based',

  normalizeAddress: normalizeSolanaAddress,

  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
    new SolanaImporter(providerManager, {
      preferredProvider: providerName,
    }),

  createProcessor: ({ providerManager, scamDetectionService }) =>
    new SolanaProcessor(providerManager, scamDetectionService),
};

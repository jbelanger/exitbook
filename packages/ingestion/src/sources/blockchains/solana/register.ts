import { type IBlockchainProviderManager } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeSolanaAddress } from './address-utils.js';
import { SolanaImporter } from './importer.js';
import { SolanaProcessor } from './processor.js';

export const solanaAdapters: BlockchainAdapter[] = [
  {
    blockchain: 'solana',
    chainModel: 'account-based',

    normalizeAddress: normalizeSolanaAddress,

    createImporter: (providerManager: IBlockchainProviderManager, providerName?: string) =>
      new SolanaImporter(providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ providerManager, scamDetectionService }) =>
      new SolanaProcessor(providerManager, scamDetectionService),
  },
];

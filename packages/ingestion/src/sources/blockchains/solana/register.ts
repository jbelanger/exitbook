import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeSolanaAddress } from './address-utils.js';
import { SolanaImporter } from './importer.js';
import { SolanaProcessor } from './processor.js';

export const solanaAdapters: BlockchainAdapter[] = [
  {
    blockchain: 'solana',
    chainModel: 'account-based',

    normalizeAddress: normalizeSolanaAddress,

    createImporter: (providerRuntime: IBlockchainProviderRuntime, providerName?: string) =>
      new SolanaImporter(providerRuntime, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ providerRuntime, scamDetector }) => new SolanaProcessor(providerRuntime, scamDetector),
  },
];

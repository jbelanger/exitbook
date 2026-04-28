import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { getSolanaChainConfig } from '@exitbook/blockchain-providers/solana';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeSolanaAddress } from './address-utils.js';
import { SolanaImporter } from './importer.js';
import { SolanaProcessorV2 } from './processor-v2.js';
import { SolanaProcessor } from './processor.js';

const solanaConfig = getSolanaChainConfig('solana');

if (!solanaConfig) {
  throw new Error('Solana chain config not found');
}

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

    createLedgerProcessor: ({ providerRuntime }) => {
      const processor = new SolanaProcessorV2(solanaConfig, {
        tokenMetadataResolver: {
          getTokenMetadata: (chainName, tokenAddresses) =>
            providerRuntime.getTokenMetadata(chainName, [...tokenAddresses]),
        },
      });

      return {
        process: (normalizedData, context) =>
          processor.process(normalizedData, {
            account: context.account,
            primaryAddress: context.primaryAddress,
            userAddresses: context.userAddresses,
          }),
      };
    },
  },
];

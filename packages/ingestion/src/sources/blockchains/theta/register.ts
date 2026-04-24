import { getThetaChainConfig } from '@exitbook/blockchain-providers/theta';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeThetaAddress } from './address-utils.js';
import { ThetaImporter } from './importer.js';
import { ThetaProcessorV2 } from './processor-v2.js';
import { ThetaProcessor } from './processor.js';

const thetaConfig = getThetaChainConfig('theta');

if (!thetaConfig) {
  throw new Error('Theta chain config not found');
}

export const thetaAdapters: BlockchainAdapter[] = [
  {
    blockchain: thetaConfig.chainName,
    chainModel: 'account-based',
    normalizeAddress: normalizeThetaAddress,
    createImporter: (providerRuntime, preferredProvider) =>
      new ThetaImporter(thetaConfig, providerRuntime, { preferredProvider }),
    createProcessor: ({ providerRuntime, scamDetector }) =>
      new ThetaProcessor(thetaConfig, providerRuntime, scamDetector),
    createLedgerProcessor: ({ providerRuntime }) => {
      const processor = new ThetaProcessorV2(thetaConfig, {
        tokenMetadataResolver: {
          getTokenMetadata: (chainName, contractAddresses) =>
            providerRuntime.getTokenMetadata(chainName, [...contractAddresses]),
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

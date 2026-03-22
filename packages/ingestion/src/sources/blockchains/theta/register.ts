import { getThetaChainConfig } from '@exitbook/blockchain-providers/theta';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeThetaAddress } from './address-utils.js';
import { ThetaImporter } from './importer.js';
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
    createImporter: (providerManager, preferredProvider) =>
      new ThetaImporter(thetaConfig, providerManager, { preferredProvider }),
    createProcessor: ({ providerManager, scamDetectionService }) =>
      new ThetaProcessor(thetaConfig, providerManager, scamDetectionService),
  },
];

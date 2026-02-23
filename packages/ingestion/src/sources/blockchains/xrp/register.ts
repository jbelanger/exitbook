import { XRP_CHAINS, getXrpChainConfig } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeXrpAddress } from './address-utils.js';
import { XrpImporter } from './importer.js';
import { XrpProcessor } from './processor.js';

export const xrpAdapters: BlockchainAdapter[] = Object.keys(XRP_CHAINS).flatMap((chainName) => {
  const config = getXrpChainConfig(chainName);
  if (!config) return [];

  const adapter: BlockchainAdapter = {
    blockchain: chainName,
    chainModel: 'account-based',
    createImporter: (providerManager, preferredProvider) =>
      new XrpImporter(config, providerManager, { preferredProvider }),
    createProcessor: ({ scamDetectionService }) => new XrpProcessor(config, scamDetectionService),

    normalizeAddress: normalizeXrpAddress,
  };

  return [adapter];
});

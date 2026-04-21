import { XRP_CHAINS, getXrpChainConfig } from '@exitbook/blockchain-providers/xrp';

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
    createImporter: (providerRuntime, preferredProvider) =>
      new XrpImporter(config, providerRuntime, { preferredProvider }),
    createProcessor: ({ scamDetector }) => new XrpProcessor(config, scamDetector),

    normalizeAddress: normalizeXrpAddress,
  };

  return [adapter];
});

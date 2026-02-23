import { XRP_CHAINS, getXrpChainConfig } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeXrpAddress } from './address-utils.js';
import { XrpTransactionImporter } from './importer.js';
import { XrpTransactionProcessor } from './processor.js';

export const xrpAdapters: BlockchainAdapter[] = Object.keys(XRP_CHAINS).flatMap((chainName) => {
  const config = getXrpChainConfig(chainName);
  if (!config) return [];

  const adapter: BlockchainAdapter = {
    blockchain: chainName,
    chainModel: 'account-based',
    createImporter: (providerManager, preferredProvider) =>
      new XrpTransactionImporter(config, providerManager, { preferredProvider }),
    createProcessor: ({ scamDetectionService }) => new XrpTransactionProcessor(config, scamDetectionService),

    normalizeAddress: (address: string) => normalizeXrpAddress(address),
  };

  return [adapter];
});

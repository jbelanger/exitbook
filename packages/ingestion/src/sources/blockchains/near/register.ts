import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeNearAddress } from './address-utils.js';
import { NearImporter } from './importer.js';
import { NearProcessor } from './processor.js';

export const nearAdapter: BlockchainAdapter = {
  blockchain: 'near',
  chainModel: 'account-based',

  normalizeAddress: normalizeNearAddress,

  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
    new NearImporter(providerManager, {
      preferredProvider: providerName,
    }),

  createProcessor: ({ providerManager, scamDetectionService, db, accountId }) => {
    return new NearProcessor(providerManager, scamDetectionService, db.nearRawData, accountId);
  },
};

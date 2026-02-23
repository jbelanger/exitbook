import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { createNearRawDataQueries } from '@exitbook/data';

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

  createProcessor: ({ tokenMetadataService, scamDetectionService, db, accountId }) => {
    const nearRawDataQueries = createNearRawDataQueries(db);
    return new NearProcessor(tokenMetadataService, scamDetectionService, nearRawDataQueries, accountId);
  },
};

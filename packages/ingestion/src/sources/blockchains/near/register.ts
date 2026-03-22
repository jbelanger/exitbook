import { type IBlockchainProviderManager } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeNearAddress } from './address-utils.js';
import { NearImporter } from './importer.js';
import { NearProcessor } from './processor.js';

export const nearAdapters: BlockchainAdapter[] = [
  {
    blockchain: 'near',
    chainModel: 'account-based',

    normalizeAddress: normalizeNearAddress,

    createImporter: (providerManager: IBlockchainProviderManager, providerName?: string) =>
      new NearImporter(providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ providerManager, scamDetectionService, nearBatchSource, accountId }) => {
      return new NearProcessor(providerManager, scamDetectionService, nearBatchSource, accountId);
    },
  },
];

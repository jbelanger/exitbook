import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeNearAddress } from './address-utils.js';
import { NearImporter } from './importer.js';
import { NearProcessor } from './processor.js';

export const nearAdapters: BlockchainAdapter[] = [
  {
    blockchain: 'near',
    chainModel: 'account-based',

    normalizeAddress: normalizeNearAddress,

    createImporter: (providerRuntime: IBlockchainProviderRuntime, providerName?: string) =>
      new NearImporter(providerRuntime, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ providerRuntime, scamDetectionService, nearBatchSource, accountId }) => {
      return new NearProcessor(providerRuntime, scamDetectionService, nearBatchSource, accountId);
    },
  },
];

import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';

import type { INearBatchSource } from '../../../ports/near-batch-source.js';
import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeNearAddress } from './address-utils.js';
import { NearImporter } from './importer.js';
import { NearProcessorV2 } from './processor-v2.js';
import { NearProcessor } from './processor.js';

export function createNearAdapters(
  options: {
    nearBatchSource?: INearBatchSource | undefined;
  } = {}
): BlockchainAdapter[] {
  return [
    {
      blockchain: 'near',
      chainModel: 'account-based',

      normalizeAddress: normalizeNearAddress,

      createImporter: (providerRuntime: IBlockchainProviderRuntime, providerName?: string) =>
        new NearImporter(providerRuntime, {
          preferredProvider: providerName,
        }),

      createProcessor: ({ providerRuntime, scamDetector }) => {
        return new NearProcessor(providerRuntime, scamDetector, options.nearBatchSource);
      },

      createLedgerProcessor: ({ providerRuntime }) => {
        return new NearProcessorV2(providerRuntime, options.nearBatchSource);
      },
    },
  ];
}

export const nearAdapters = createNearAdapters();

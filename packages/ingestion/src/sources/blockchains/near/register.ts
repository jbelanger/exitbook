import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { createNearRawDataQueries } from '@exitbook/data';

import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { normalizeNearAddress } from './address-utils.js';
import { NearTransactionImporter } from './importer.js';
import { NearTransactionProcessor } from './processor.js';

export function registerNearChain(): void {
  registerBlockchain({
    blockchain: 'near',
    chainModel: 'account-based',

    normalizeAddress: (address: string) => normalizeNearAddress(address),

    createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
      new NearTransactionImporter(providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ tokenMetadataService, scamDetectionService, db, accountId }) => {
      const nearRawDataQueries = createNearRawDataQueries(db);
      return new NearTransactionProcessor(tokenMetadataService, scamDetectionService, nearRawDataQueries, accountId);
    },
  });
}

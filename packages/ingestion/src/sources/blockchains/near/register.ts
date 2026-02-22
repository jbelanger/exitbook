import { isValidNearAccountId } from '@exitbook/blockchain-providers';
import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { NearRawDataQueries } from '@exitbook/data';
import { err, ok } from 'neverthrow';

import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { NearTransactionImporter } from './importer.js';
import { NearTransactionProcessor } from './processor.js';

export function registerNearChain(): void {
  registerBlockchain({
    blockchain: 'near',

    normalizeAddress: (address: string) => {
      // NEAR accounts are case-sensitive - preserve original casing
      // Supports both implicit accounts (64-char hex) and named accounts (.near, .testnet, etc.)
      if (!isValidNearAccountId(address)) {
        return err(new Error(`Invalid NEAR account ID format: ${address}`));
      }
      return ok(address);
    },

    createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
      new NearTransactionImporter(providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: (
      _providerManager,
      tokenMetadataService?: ITokenMetadataService,
      scamDetectionService?: IScamDetectionService,
      rawDataQueries?,
      accountId?
    ) => {
      if (!tokenMetadataService) {
        return err(new Error('TokenMetadataService is required for NEAR processor'));
      }
      // rawDataQueries is actually NearRawDataQueries for NEAR blockchain
      const nearRawDataQueries = rawDataQueries as NearRawDataQueries | undefined;
      return ok(
        new NearTransactionProcessor(tokenMetadataService, scamDetectionService, nearRawDataQueries, accountId)
      );
    },
  });
}

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { SolanaTransactionImporter } from './importer.js';
import { SolanaTransactionProcessor } from './processor.js';

export function registerSolanaChain(): void {
  registerBlockchain({
    blockchain: 'solana',

    normalizeAddress: (address: string) => {
      // Solana addresses are case-sensitive base58 - do NOT lowercase
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        return err(new Error(`Invalid Solana address format: ${address}`));
      }
      return ok(address);
    },

    createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
      new SolanaTransactionImporter(providerManager, {
        preferredProvider: providerName,
      }),

    createProcessor: (
      _providerManager,
      tokenMetadataService?: ITokenMetadataService,
      scamDetectionService?: IScamDetectionService,
      _rawDataQueries?,
      _accountId?
    ) => {
      if (!tokenMetadataService) {
        return err(new Error('TokenMetadataService is required for Solana processor'));
      }
      return ok(new SolanaTransactionProcessor(tokenMetadataService, scamDetectionService));
    },
  });
}

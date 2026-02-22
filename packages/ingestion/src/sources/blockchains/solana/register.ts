import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

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

    createProcessor: ({ tokenMetadataService, scamDetectionService }) =>
      ok(new SolanaTransactionProcessor(tokenMetadataService, scamDetectionService)),
  });
}

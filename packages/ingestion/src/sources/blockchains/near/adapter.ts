import { isValidNearAccountId } from '@exitbook/blockchain-providers';
import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../core/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../../../core/types/blockchain-adapter.ts';

import { NearTransactionImporter } from './importer.js';
import { NearTransactionProcessor } from './processor.js';

/**
 * NEAR blockchain configuration
 */

/**
 * NEAR native token decimals
 * 1 NEAR = 10^24 yoctoNEAR
 */
export const NEAR_DECIMALS = 24;

/**
 * NEAR native token symbol
 */
export const NEAR_SYMBOL = 'NEAR';

/**
 * NEAR blockchain identifier
 */
export const NEAR_BLOCKCHAIN = 'near';

/**
 * NEAR mainnet network identifier
 */
export const NEAR_MAINNET = 'mainnet';

/**
 * NEAR testnet network identifier
 */
export const NEAR_TESTNET = 'testnet';

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

  createProcessor: (tokenMetadataService?: ITokenMetadataService) => {
    if (!tokenMetadataService) {
      return err(new Error('TokenMetadataService is required for NEAR processor'));
    }
    return ok(new NearTransactionProcessor(tokenMetadataService));
  },
});

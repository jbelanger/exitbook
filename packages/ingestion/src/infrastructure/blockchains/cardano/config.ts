import type { BlockchainProviderManager } from '@exitbook/providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../shared/blockchain-config.js';

import { CardanoTransactionImporter } from './importer.js';
import { CardanoTransactionProcessor } from './processor.js';

registerBlockchain({
  blockchain: 'cardano',

  normalizeAddress: (address: string) => {
    // Check if it's an extended public key (128 hex characters)
    // Format: public_key (32 bytes) + chain_code (32 bytes) = 64 bytes = 128 hex chars
    if (/^[0-9a-fA-F]{128}$/.test(address)) {
      return ok(address);
    }

    // Cardano addresses are case-sensitive (Bech32 encoding)
    // Mainnet: addr1... (payment), stake1... (stake/reward)
    // Testnet: addr_test1..., stake_test1...
    // Byron-era: Ae2..., DdzFF...
    if (!/^(addr1|addr_test1|stake1|stake_test1|Ae2|DdzFF)[A-Za-z0-9]+$/.test(address)) {
      return err(new Error(`Invalid Cardano address format: ${address}`));
    }
    return ok(address);
  },

  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
    new CardanoTransactionImporter(providerManager, { preferredProvider: providerName }),

  createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new CardanoTransactionProcessor()),
});

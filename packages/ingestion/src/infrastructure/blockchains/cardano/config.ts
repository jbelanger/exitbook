import type { BlockchainProviderManager } from '@exitbook/providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../shared/blockchain-config.js';

import { CardanoTransactionImporter } from './importer.js';
import { CardanoTransactionProcessor } from './processor.js';

registerBlockchain({
  blockchain: 'cardano',

  normalizeAddress: (address: string) => {
    // Cardano addresses are case-sensitive (Bech32 encoding)
    // Mainnet: addr1... (payment), stake1... (stake/reward)
    // Testnet: addr_test1..., stake_test1...
    const normalized = address;
    if (!/^(addr1|addr_test1|stake1|stake_test1)[a-z0-9]+$/.test(normalized)) {
      return err(new Error(`Invalid Cardano address format: ${address}`));
    }
    return ok(normalized);
  },

  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
    new CardanoTransactionImporter(providerManager, { preferredProvider: providerName }),

  createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new CardanoTransactionProcessor()),
});

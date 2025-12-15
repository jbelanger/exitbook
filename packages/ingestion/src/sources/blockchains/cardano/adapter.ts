import {
  CardanoUtils,
  normalizeCardanoAddress,
  type BlockchainProviderManager,
  type CardanoWalletAddress,
} from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../core/token-metadata/token-metadata-service.interface.js';
import type { DerivedAddress } from '../shared/blockchain-adapter.ts';
import { registerBlockchain } from '../shared/blockchain-adapter.ts';

import { CardanoTransactionImporter } from './importer.js';
import { CardanoTransactionProcessor } from './processor.js';

registerBlockchain({
  blockchain: 'cardano',
  isUTXOChain: true,

  normalizeAddress: (address: string) => {
    // Use centralized normalization logic
    const normalized = normalizeCardanoAddress(address);

    // Validation for extended public keys
    if (/^[0-9a-fA-F]{128}$/.test(normalized)) {
      return ok(normalized);
    }

    // Validation for Cardano addresses
    // Shelley: addr1..., stake1... (Bech32 - normalized to lowercase)
    // Byron: Ae2..., DdzFF... (Base58 - case-sensitive)
    if (!/^(addr1|addr_test1|stake1|stake_test1|Ae2|DdzFF)[A-Za-z0-9]+$/.test(normalized)) {
      return err(new Error(`Invalid Cardano address format: ${address}`));
    }
    return ok(normalized);
  },

  isExtendedPublicKey: (address: string) => CardanoUtils.isExtendedPublicKey(address),

  deriveAddressesFromXpub: async (
    xpub: string,
    providerManager: BlockchainProviderManager,
    _blockchain: string,
    gap?: number
  ): Promise<DerivedAddress[]> => {
    // Use the proper wallet initialization that includes provider manager for gap scanning
    const walletAddress: CardanoWalletAddress = {
      address: xpub,
      type: 'xpub',
    };

    const initResult = await CardanoUtils.initializeXpubWallet(walletAddress, providerManager, gap ?? 10);

    if (initResult.isErr()) {
      throw initResult.error;
    }

    // Return the optimized addresses (filtered by gap scanning)
    // Reconstruct derivation paths from interleaved index
    // Pattern: [0/0 (external), 1/0 (internal), 0/1 (external), 1/1 (internal), ...]
    const optimizedAddresses = walletAddress.derivedAddresses || [];

    return optimizedAddresses.map((address: string, index: number) => {
      const role = index % 2; // 0 = external, 1 = internal
      const addressIndex = Math.floor(index / 2);
      return {
        address,
        derivationPath: `${role}/${addressIndex}`,
      };
    });
  },

  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
    new CardanoTransactionImporter(providerManager, { preferredProvider: providerName }),

  createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new CardanoTransactionProcessor()),
});

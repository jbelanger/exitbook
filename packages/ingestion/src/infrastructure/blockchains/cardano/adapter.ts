import {
  CardanoUtils,
  type BlockchainProviderManager,
  type CardanoWalletAddress,
} from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import type { DerivedAddress } from '../shared/blockchain-adapter.ts';
import { registerBlockchain } from '../shared/blockchain-adapter.ts';

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

    // Return the derived addresses - derivation paths are already stored during initialization
    // We need to re-derive to get the paths since they aren't stored in derivedAddresses
    const derivedWithPaths = await CardanoUtils.deriveAddressesFromXpub(xpub, gap ?? 10);
    const optimizedAddresses = walletAddress.derivedAddresses || [];

    // Filter the derived addresses to only include those that were kept after gap scanning
    return derivedWithPaths
      .filter((addr) => optimizedAddresses.includes(addr.address))
      .map((addr) => ({
        address: addr.address,
        derivationPath: addr.derivationPath,
      }));
  },

  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
    new CardanoTransactionImporter(providerManager, { preferredProvider: providerName }),

  createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new CardanoTransactionProcessor()),
});

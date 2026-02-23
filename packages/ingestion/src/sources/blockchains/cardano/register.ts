import {
  initializeCardanoXpubWallet,
  isCardanoXpub,
  type BlockchainProviderManager,
  type CardanoWalletAddress,
} from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

import type { BlockchainAdapter, DerivedAddress } from '../../../shared/types/blockchain-adapter.js';

import { normalizeCardanoAddress } from './address-utils.js';
import { CardanoImporter } from './importer.js';
import { CardanoProcessor } from './processor.js';

export const cardanoAdapter: BlockchainAdapter = {
  blockchain: 'cardano',
  chainModel: 'utxo',

  normalizeAddress: normalizeCardanoAddress,

  isExtendedPublicKey: isCardanoXpub,

  deriveAddressesFromXpub: async (
    xpub: string,
    providerManager: BlockchainProviderManager,
    _blockchain: string,
    gap?: number
  ): Promise<Result<DerivedAddress[], Error>> => {
    const walletAddress: CardanoWalletAddress = {
      address: xpub,
      type: 'xpub',
    };

    const initResult = await initializeCardanoXpubWallet(walletAddress, providerManager, gap ?? 10);

    if (initResult.isErr()) {
      return err(initResult.error);
    }

    const optimizedAddresses = walletAddress.derivedAddresses ?? [];

    return ok(
      optimizedAddresses.map((address: string, index: number) => {
        const role = index % 2; // 0 = external, 1 = internal
        const addressIndex = Math.floor(index / 2);
        return {
          address,
          derivationPath: `${role}/${addressIndex}`,
        };
      })
    );
  },

  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
    new CardanoImporter(providerManager, { preferredProvider: providerName }),

  createProcessor: ({ scamDetectionService }) => new CardanoProcessor(scamDetectionService),
};

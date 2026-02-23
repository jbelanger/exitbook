import {
  CardanoUtils,
  type BlockchainProviderManager,
  type CardanoWalletAddress,
} from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

import type { BlockchainAdapter, DerivedAddress } from '../../../shared/types/blockchain-adapter.js';

import { normalizeCardanoAddress } from './address-utils.js';
import { CardanoTransactionImporter } from './importer.js';
import { CardanoTransactionProcessor } from './processor.js';

export const cardanoAdapter: BlockchainAdapter = {
  blockchain: 'cardano',
  chainModel: 'utxo',

  normalizeAddress: (address: string) => normalizeCardanoAddress(address),

  isExtendedPublicKey: (address: string) => CardanoUtils.isExtendedPublicKey(address),

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

    const initResult = await CardanoUtils.initializeXpubWallet(walletAddress, providerManager, gap ?? 10);

    if (initResult.isErr()) {
      return err(initResult.error);
    }

    const optimizedAddresses = walletAddress.derivedAddresses || [];

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
    new CardanoTransactionImporter(providerManager, { preferredProvider: providerName }),

  createProcessor: ({ scamDetectionService }) => new CardanoTransactionProcessor(scamDetectionService),
};

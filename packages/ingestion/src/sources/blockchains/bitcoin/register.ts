import {
  BITCOIN_CHAINS,
  getBitcoinChainConfig,
  initializeBitcoinXpubWallet,
  isBitcoinXpub,
  type BitcoinWalletAddress,
} from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

import type { BlockchainAdapter, DerivedAddress } from '../../../shared/types/blockchain-adapter.js';

import { normalizeBitcoinAddress } from './address-utils.js';
import { BitcoinTransactionImporter } from './importer.js';
import { BitcoinTransactionProcessor } from './processor.js';

export const bitcoinAdapters: BlockchainAdapter[] = Object.keys(BITCOIN_CHAINS).flatMap((chainName) => {
  const config = getBitcoinChainConfig(chainName);
  if (!config) return [];

  const adapter: BlockchainAdapter = {
    blockchain: chainName,
    chainModel: 'utxo',
    createImporter: (providerManager, preferredProvider) =>
      new BitcoinTransactionImporter(config, providerManager, { preferredProvider }),
    createProcessor: ({ scamDetectionService }) => new BitcoinTransactionProcessor(config, scamDetectionService),

    isExtendedPublicKey: isBitcoinXpub,

    deriveAddressesFromXpub: async (
      xpub: string,
      providerManager,
      blockchain: string,
      gap?: number
    ): Promise<Result<DerivedAddress[], Error>> => {
      const walletAddress: BitcoinWalletAddress = {
        address: xpub,
        type: 'xpub',
      };

      const initResult = await initializeBitcoinXpubWallet(walletAddress, blockchain, providerManager, gap ?? 20);

      if (initResult.isErr()) {
        return err(initResult.error);
      }

      const derivedAddresses = walletAddress.derivedAddresses ?? [];
      return ok(
        derivedAddresses.map((address: string, index: number) => ({
          address,
          derivationPath: `m/${Math.floor(index / 2) % 2}/${Math.floor(index / 2)}`,
        }))
      );
    },

    normalizeAddress: (address: string) => normalizeBitcoinAddress(address, config),
  };

  return [adapter];
});

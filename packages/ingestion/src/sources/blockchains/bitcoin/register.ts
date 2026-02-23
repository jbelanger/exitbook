import {
  BITCOIN_CHAINS,
  getBitcoinChainConfig,
  initializeBitcoinXpubWallet,
  isBitcoinXpub,
  type BitcoinWalletAddress,
} from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

import type { DerivedAddress } from '../../../shared/types/blockchain-adapter.js';
import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { normalizeBitcoinAddress } from './address-utils.js';
import { BitcoinTransactionImporter } from './importer.js';
import { BitcoinTransactionProcessor } from './processor.js';

export function registerBitcoinChains(): void {
  for (const chainName of Object.keys(BITCOIN_CHAINS)) {
    const config = getBitcoinChainConfig(chainName);
    if (!config) continue;

    registerBlockchain({
      blockchain: chainName,
      chainModel: 'utxo',
      createImporter: (providerManager, preferredProvider) =>
        new BitcoinTransactionImporter(config, providerManager, { preferredProvider }),
      createProcessor: ({ scamDetectionService }) => new BitcoinTransactionProcessor(config, scamDetectionService),

      isExtendedPublicKey: (address: string) => isBitcoinXpub(address),

      deriveAddressesFromXpub: async (
        xpub: string,
        providerManager,
        blockchain: string,
        gap?: number
      ): Promise<Result<DerivedAddress[], Error>> => {
        // Use the proper wallet initialization that includes provider manager for smart detection and gap scanning
        const walletAddress: BitcoinWalletAddress = {
          address: xpub,
          type: 'xpub',
        };

        const initResult = await initializeBitcoinXpubWallet(walletAddress, blockchain, providerManager, gap ?? 20);

        if (initResult.isErr()) {
          return err(initResult.error);
        }

        // Return the derived addresses with derivation paths
        const derivedAddresses = walletAddress.derivedAddresses || [];
        return ok(
          derivedAddresses.map((address: string, index: number) => ({
            address,
            derivationPath: `m/${Math.floor(index / 2) % 2}/${Math.floor(index / 2)}`,
          }))
        );
      },

      normalizeAddress: (address: string) => normalizeBitcoinAddress(address, config),
    });
  }
}

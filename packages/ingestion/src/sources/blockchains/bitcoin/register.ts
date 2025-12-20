import {
  BITCOIN_CHAINS,
  BitcoinUtils,
  getBitcoinChainConfig,
  normalizeBitcoinAddress,
  type BitcoinWalletAddress,
} from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import type { DerivedAddress } from '../../../shared/types/blockchain-adapter.js';
import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { BitcoinTransactionImporter } from './importer.js';
import { BitcoinTransactionProcessor } from './processor.js';

export function registerBitcoinChains(): void {
  for (const chainName of Object.keys(BITCOIN_CHAINS)) {
    const config = getBitcoinChainConfig(chainName);
    if (!config) continue;

    registerBlockchain({
      blockchain: chainName,
      isUTXOChain: true,
      createImporter: (providerManager, preferredProvider) =>
        new BitcoinTransactionImporter(config, providerManager, { preferredProvider }),
      createProcessor: (_providerManager, _tokenMetadataService?: ITokenMetadataService) =>
        ok(new BitcoinTransactionProcessor(config)),

      isExtendedPublicKey: (address: string) => BitcoinUtils.isXpub(address),

      deriveAddressesFromXpub: async (
        xpub: string,
        providerManager,
        blockchain: string,
        gap?: number
      ): Promise<DerivedAddress[]> => {
        // Use the proper wallet initialization that includes provider manager for smart detection and gap scanning
        const walletAddress: BitcoinWalletAddress = {
          address: xpub,
          type: 'xpub',
        };

        const initResult = await BitcoinUtils.initializeXpubWallet(
          walletAddress,
          blockchain,
          providerManager,
          gap ?? 20
        );

        if (initResult.isErr()) {
          throw initResult.error;
        }

        // Return the derived addresses with derivation paths
        const derivedAddresses = walletAddress.derivedAddresses || [];
        return derivedAddresses.map((address: string, index: number) => ({
          address,
          derivationPath: `m/${Math.floor(index / 2) % 2}/${Math.floor(index / 2)}`,
        }));
      },

      normalizeAddress: (address: string) => {
        // Use centralized normalization logic
        const normalized = normalizeBitcoinAddress(address);

        // Validation for xpub/ypub/zpub formats
        if (/^[xyz]pub/i.test(address)) {
          if (!/^[xyz]pub[a-zA-Z0-9]{79,108}$/.test(normalized)) {
            return err(new Error(`Invalid xpub format: ${address}`));
          }
          return ok(normalized);
        }

        // Validation for Bech32 addresses
        if (normalized.startsWith('bc1') || normalized.startsWith('ltc1') || normalized.startsWith('doge1')) {
          if (!/^(bc1|ltc1|doge1)[a-z0-9]{25,62}$/.test(normalized)) {
            return err(new Error(`Invalid Bech32 address format: ${address}`));
          }
          return ok(normalized);
        }

        // Validation for CashAddr format (Bitcoin Cash)
        if (normalized.startsWith('bitcoincash:')) {
          if (!/^bitcoincash:[qp][a-z0-9]{41}$/.test(normalized)) {
            return err(new Error(`Invalid Bitcoin Cash CashAddr format: ${address}`));
          }
          return ok(normalized);
        }

        // Validation for CashAddr short format
        if (normalized.startsWith('q') || normalized.startsWith('p')) {
          if (!/^[qp][a-z0-9]{41}$/.test(normalized)) {
            return err(new Error(`Invalid Bitcoin Cash CashAddr short format: ${address}`));
          }
          return ok(normalized);
        }

        // Validation for legacy addresses (Base58)
        const prefixes = config.addressPrefixes || [];
        const matchingPrefix = prefixes.find((prefix) => address.startsWith(prefix));

        if (!matchingPrefix) {
          return err(
            new Error(`Invalid ${config.displayName} address: must start with one of [${prefixes.join(', ')}]`)
          );
        }

        // Validate Base58 format (25-34 characters, valid Base58 alphabet)
        if (!/^[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(normalized)) {
          return err(new Error(`Invalid ${config.displayName} legacy address format: ${address}`));
        }

        return ok(normalized);
      },
    });
  }
}

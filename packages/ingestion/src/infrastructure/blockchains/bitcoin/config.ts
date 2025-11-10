import { BITCOIN_CHAINS, getBitcoinChainConfig } from '@exitbook/providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../services/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../shared/blockchain-config.js';

import { BitcoinTransactionImporter } from './importer.js';
import { BitcoinTransactionProcessor } from './processor.js';

// Register each Bitcoin-like chain dynamically
for (const chainName of Object.keys(BITCOIN_CHAINS)) {
  const config = getBitcoinChainConfig(chainName);
  if (!config) continue;

  registerBlockchain({
    blockchain: chainName,
    createImporter: (providerManager, preferredProvider) =>
      new BitcoinTransactionImporter(config, providerManager, { preferredProvider }),
    createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new BitcoinTransactionProcessor(config)),
    normalizeAddress: (address: string) => {
      // Handle xpub/ypub/zpub formats (case-sensitive)
      if (/^[xyz]pub/i.test(address)) {
        if (!/^[xyz]pub[a-zA-Z0-9]{79,108}$/.test(address)) {
          return err(new Error(`Invalid xpub format: ${address}`));
        }
        return ok(address);
      }

      // Handle Bech32 addresses (lowercase them)
      const lowerAddress = address.toLowerCase();
      if (lowerAddress.startsWith('bc1') || lowerAddress.startsWith('ltc1')) {
        if (!/^(bc1|ltc1)[a-z0-9]{25,62}$/.test(lowerAddress)) {
          return err(new Error(`Invalid Bech32 address format: ${address}`));
        }
        return ok(lowerAddress);
      }

      // Handle CashAddr format for Bitcoin Cash
      const lowerCaseAddr = address.toLowerCase();
      if (lowerCaseAddr.startsWith('bitcoincash:')) {
        // Long form CashAddr validation
        if (!/^bitcoincash:[qp][a-z0-9]{41}$/i.test(address)) {
          return err(new Error(`Invalid Bitcoin Cash CashAddr format: ${address}`));
        }
        return ok(lowerCaseAddr);
      }

      // Handle CashAddr short format (without bitcoincash: prefix)
      if (lowerCaseAddr.startsWith('q') || lowerCaseAddr.startsWith('p')) {
        // Short form CashAddr validation (q/p + 41 chars)
        if (!/^[qp][a-z0-9]{41}$/.test(lowerCaseAddr)) {
          return err(new Error(`Invalid Bitcoin Cash CashAddr short format: ${address}`));
        }
        return ok(lowerCaseAddr);
      }

      // Handle legacy addresses (case-sensitive Base58)
      // Validate that address starts with one of the chain's prefixes
      const prefixes = config.addressPrefixes || [];
      const matchingPrefix = prefixes.find((prefix) => address.startsWith(prefix));

      if (!matchingPrefix) {
        return err(new Error(`Invalid ${config.displayName} address: must start with one of [${prefixes.join(', ')}]`));
      }

      // Validate Base58 format (25-34 characters, valid Base58 alphabet)
      if (!/^[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) {
        return err(new Error(`Invalid ${config.displayName} legacy address format: ${address}`));
      }

      return ok(address);
    },
  });
}

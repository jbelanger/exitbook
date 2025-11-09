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
      // Only lowercase Bech32 addresses (bc1...) - legacy and xpub are case-sensitive
      let normalized: string;
      if (address.toLowerCase().startsWith('bc1')) {
        normalized = address.toLowerCase();
        if (!/^bc1[a-z0-9]{25,62}$/.test(normalized)) {
          return err(new Error(`Invalid Bitcoin Bech32 address format: ${address}`));
        }
      } else if (/^[xyz]pub/i.test(address)) {
        // xpub/ypub/zpub are case-sensitive - preserve original casing
        normalized = address;
        if (!/^[xyz]pub[a-zA-Z0-9]{79,108}$/.test(normalized)) {
          return err(new Error(`Invalid Bitcoin xpub format: ${address}`));
        }
      } else {
        // Legacy addresses (1... or 3...) are case-sensitive Base58
        normalized = address;
        if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(normalized)) {
          return err(new Error(`Invalid Bitcoin legacy address format: ${address}`));
        }
      }
      return ok(normalized);
    },
  });
}

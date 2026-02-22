import { XRP_CHAINS, getXrpChainConfig } from '@exitbook/blockchain-providers';

import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { normalizeXrpAddress } from './address-utils.js';
import { XrpTransactionImporter } from './importer.js';
import { XrpTransactionProcessor } from './processor.js';

export function registerXrpChains(): void {
  for (const chainName of Object.keys(XRP_CHAINS)) {
    const config = getXrpChainConfig(chainName);
    if (!config) continue;

    registerBlockchain({
      blockchain: chainName,
      isUTXOChain: false,
      createImporter: (providerManager, preferredProvider) =>
        new XrpTransactionImporter(config, providerManager, { preferredProvider }),
      createProcessor: ({ scamDetectionService }) => new XrpTransactionProcessor(config, scamDetectionService),

      normalizeAddress: (address: string) => normalizeXrpAddress(address),
    });
  }
}

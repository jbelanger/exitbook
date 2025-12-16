import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { getSubstrateChainConfig, SUBSTRATE_CHAINS } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../../../shared/types/blockchain-adapter.ts';

import { SubstrateImporter } from './importer.js';
import { SubstrateProcessor } from './processor.js';

export function registerSubstrateChains(): void {
  for (const chainName of Object.keys(SUBSTRATE_CHAINS)) {
    const config = getSubstrateChainConfig(chainName);
    if (!config) continue;

    registerBlockchain({
      blockchain: chainName,

      normalizeAddress: (address: string) => {
        // Substrate addresses use SS58 format - case-sensitive
        if (!/^[1-9A-HJ-NP-Za-km-z]{46,48}$/.test(address)) {
          return err(new Error(`Invalid Substrate address format for ${chainName}: ${address}`));
        }
        return ok(address);
      },

      createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
        new SubstrateImporter(config, providerManager, {
          preferredProvider: providerName,
        }),

      createProcessor: (_tokenMetadataService?: ITokenMetadataService) => ok(new SubstrateProcessor(config)),
    });
  }
}

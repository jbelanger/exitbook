import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { COSMOS_CHAINS, getCosmosChainConfig } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import { HashGroupedBatchProvider } from '../../../features/process/batch-providers/hash-grouped-batch-provider.js';
import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

import { CosmosImporter } from './importer.js';
import { CosmosProcessor } from './processor.js';

export function registerCosmosChains(): void {
  for (const chainName of Object.keys(COSMOS_CHAINS)) {
    const config = getCosmosChainConfig(chainName);
    if (!config) continue;

    registerBlockchain({
      blockchain: chainName,

      normalizeAddress: (address: string) => {
        // Cosmos addresses use bech32 format - case-sensitive
        // Format: <prefix>1<data> (e.g., inj1..., cosmos1..., osmo1...)
        if (!/^[a-z]+1[a-z0-9]{38,58}$/.test(address)) {
          return err(new Error(`Invalid Cosmos address format for ${chainName}: ${address}`));
        }
        return ok(address);
      },

      createImporter: (providerManager: BlockchainProviderManager, providerName?: string) =>
        new CosmosImporter(config, providerManager, {
          preferredProvider: providerName,
        }),

      createBatchProvider: (rawDataQueries, _db, accountId, batchSize) =>
        new HashGroupedBatchProvider(rawDataQueries, accountId, batchSize),

      createProcessor: (
        _providerManager,
        _tokenMetadataService?: ITokenMetadataService,
        scamDetectionService?: IScamDetectionService,
        _db?,
        _accountId?
      ) => ok(new CosmosProcessor(config, scamDetectionService)),
    });
  }
}

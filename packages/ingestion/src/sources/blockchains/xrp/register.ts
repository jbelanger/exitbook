import { XRP_CHAINS, getXrpChainConfig, normalizeXrpAddress } from '@exitbook/blockchain-providers';
import { err, ok } from 'neverthrow';

import type { IScamDetectionService } from '../../../features/scam-detection/scam-detection-service.interface.js';
import type { ITokenMetadataService } from '../../../features/token-metadata/token-metadata-service.interface.js';
import { registerBlockchain } from '../../../shared/types/blockchain-adapter.js';

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
      createProcessor: (
        _providerManager,
        _tokenMetadataService?: ITokenMetadataService,
        scamDetectionService?: IScamDetectionService,
        _rawDataRepository?,
        _accountId?
      ) => ok(new XrpTransactionProcessor(config, scamDetectionService)),

      normalizeAddress: (address: string) => {
        // Use centralized normalization logic
        const normalized = normalizeXrpAddress(address);

        // Validate XRP address format (starts with 'r', 25-35 characters)
        if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(normalized)) {
          return err(new Error(`Invalid XRP address format: ${address}`));
        }

        return ok(normalized);
      },
    });
  }
}

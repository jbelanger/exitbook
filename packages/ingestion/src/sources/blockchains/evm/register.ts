import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { EVM_CHAINS, getEvmChainConfig } from '@exitbook/blockchain-providers/evm';

import type { BlockchainAdapter } from '../../../shared/types/blockchain-adapter.js';

import { normalizeEvmAddress } from './address-utils.js';
import { EvmImporter } from './importer.js';
import { EvmProcessorV2 } from './processor-v2.js';
import { EvmProcessor } from './processor.js';

export const evmAdapters: BlockchainAdapter[] = Object.keys(EVM_CHAINS).flatMap((chainName) => {
  const config = getEvmChainConfig(chainName);
  if (!config) return [];

  const adapter: BlockchainAdapter = {
    blockchain: chainName,
    chainModel: 'account-based',

    normalizeAddress: (address: string) => normalizeEvmAddress(address, chainName),

    createImporter: (providerRuntime: IBlockchainProviderRuntime, providerName?: string) =>
      new EvmImporter(config, providerRuntime, {
        preferredProvider: providerName,
      }),

    createProcessor: ({ providerRuntime, scamDetector }) => new EvmProcessor(config, providerRuntime, scamDetector),

    createLedgerProcessor: ({ providerRuntime }) => {
      const processor = new EvmProcessorV2(config, {
        tokenMetadataResolver: {
          getTokenMetadata: (chainName, contractAddresses) =>
            providerRuntime.getTokenMetadata(chainName, [...contractAddresses]),
        },
      });

      return {
        process: (normalizedData, context) =>
          processor.process(normalizedData, {
            account: context.account,
            primaryAddress: context.primaryAddress,
            userAddresses: context.userAddresses,
          }),
      };
    },
  };

  return [adapter];
});

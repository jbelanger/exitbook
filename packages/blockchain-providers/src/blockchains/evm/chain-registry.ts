import { defineChainRegistry, mapChainRegistryValues } from '../shared/chain-registry-utils.js';

import type { EvmChainConfig } from './chain-config.interface.js';
import evmChainsData from './evm-chains.json' with { type: 'json' };

/**
 * Registry of all supported EVM-compatible chains
 * Loaded from evm-chains.json for easy maintenance
 *
 * Usage:
 * ```typescript
 * const importer = new EvmImporter(EVM_CHAINS.ethereum, manager);
 * const processor = new EvmProcessor(EVM_CHAINS.avalanche);
 * ```
 */
const evmChains = defineChainRegistry<EvmChainConfig, typeof evmChainsData>(evmChainsData);

export const EVM_CHAINS = mapChainRegistryValues(
  evmChains,
  (_chainName, config): EvmChainConfig => ({
    ...config,
    providerHints: {
      ...config.providerHints,
      coingecko: {
        ...config.providerHints?.coingecko,
        chainIdentifier: config.providerHints?.coingecko?.chainIdentifier ?? config.chainId,
        tokenRefFormat: config.providerHints?.coingecko?.tokenRefFormat ?? 'evm-contract',
      },
    },
  })
);

/**
 * Type-safe chain names
 */
export type EvmChainName = keyof typeof EVM_CHAINS;

/**
 * Helper to get chain config by name
 *
 * @public
 */
export function getEvmChainConfig(chainName: EvmChainName): EvmChainConfig;
export function getEvmChainConfig(chainName: string): EvmChainConfig | undefined;
export function getEvmChainConfig(chainName: string): EvmChainConfig | undefined {
  return chainName in EVM_CHAINS ? EVM_CHAINS[chainName as EvmChainName] : undefined;
}

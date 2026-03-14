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
const evmChains = evmChainsData as unknown as Record<string, EvmChainConfig>;

export const EVM_CHAINS = Object.fromEntries(
  Object.entries(evmChains).map(([chainName, config]) => [
    chainName,
    {
      ...config,
      providerHints: {
        ...config.providerHints,
        coingecko: {
          ...config.providerHints?.coingecko,
          chainIdentifier: config.providerHints?.coingecko?.chainIdentifier ?? config.chainId,
          tokenRefFormat: config.providerHints?.coingecko?.tokenRefFormat ?? 'evm-contract',
        },
      },
    },
  ])
) as Record<string, EvmChainConfig>;

/**
 * Type-safe chain names
 */
export type EvmChainName = keyof typeof EVM_CHAINS;

/**
 * Helper to get chain config by name
 *
 * @public
 */
export function getEvmChainConfig(chainName: string): EvmChainConfig | undefined {
  return EVM_CHAINS[chainName];
}

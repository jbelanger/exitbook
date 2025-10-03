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
export const EVM_CHAINS = evmChainsData as Record<string, EvmChainConfig>;

/**
 * Type-safe chain names
 */
export type EvmChainName = keyof typeof EVM_CHAINS;

/**
 * Helper to get chain config by name
 */
export function getEvmChainConfig(chainName: string): EvmChainConfig | undefined {
  return EVM_CHAINS[chainName];
}

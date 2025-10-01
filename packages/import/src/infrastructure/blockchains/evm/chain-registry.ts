import { AVALANCHE_CONFIG } from '../avalanche/config.js';
import { ETHEREUM_CONFIG } from '../ethereum/config.js';

import type { EvmChainConfig } from './chain-config.interface.js';

/**
 * Registry of all supported EVM-compatible chains
 *
 * Usage:
 * ```typescript
 * const importer = new EvmImporter(EVM_CHAINS.ethereum, manager);
 * const processor = new EvmProcessor(EVM_CHAINS.avalanche);
 * ```
 */
export const EVM_CHAINS = {
  avalanche: AVALANCHE_CONFIG,
  ethereum: ETHEREUM_CONFIG,
} as const satisfies Record<string, EvmChainConfig>;

/**
 * Type-safe chain names
 */
export type EvmChainName = keyof typeof EVM_CHAINS;

/**
 * Helper to get chain config by name
 */
export function getEvmChainConfig(chainName: string): EvmChainConfig | undefined {
  return EVM_CHAINS[chainName as EvmChainName];
}

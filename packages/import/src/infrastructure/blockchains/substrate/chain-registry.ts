import type { SubstrateChainConfig } from './chain-config.interface.js';
import substrateChainsData from './substrate-chains.json' with { type: 'json' };

/**
 * Registry of all supported Substrate-based chains
 *
 * Loaded from substrate-chains.json for easy configuration management.
 * To add a new Substrate chain, simply add its configuration to the JSON file.
 *
 * Usage:
 * ```typescript
 * const importer = new SubstrateImporter(SUBSTRATE_CHAINS.polkadot, manager);
 * const processor = new SubstrateProcessor(SUBSTRATE_CHAINS.bittensor);
 * ```
 */
export const SUBSTRATE_CHAINS = substrateChainsData as Record<string, SubstrateChainConfig>;

/**
 * Type-safe chain names
 */
export type SubstrateChainName = keyof typeof SUBSTRATE_CHAINS;

/**
 * Helper to get chain config by name
 */
export function getSubstrateChainConfig(chainName: string): SubstrateChainConfig | undefined {
  return SUBSTRATE_CHAINS[chainName];
}

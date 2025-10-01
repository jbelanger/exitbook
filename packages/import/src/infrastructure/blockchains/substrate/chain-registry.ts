import { BITTENSOR_CONFIG } from '../bittensor/config.js';
import { POLKADOT_CONFIG } from '../polkadot/config.js';

import type { SubstrateChainConfig } from './chain-config.interface.js';

/**
 * Registry of all supported Substrate-based chains
 *
 * Usage:
 * ```typescript
 * const importer = new SubstrateImporter(SUBSTRATE_CHAINS.polkadot, manager);
 * const processor = new SubstrateProcessor(SUBSTRATE_CHAINS.bittensor);
 * ```
 */
export const SUBSTRATE_CHAINS = {
  bittensor: BITTENSOR_CONFIG,
  polkadot: POLKADOT_CONFIG,
} as const satisfies Record<string, SubstrateChainConfig>;

/**
 * Type-safe chain names
 */
export type SubstrateChainName = keyof typeof SUBSTRATE_CHAINS;

/**
 * Helper to get chain config by name
 */
export function getSubstrateChainConfig(chainName: string): SubstrateChainConfig | undefined {
  return SUBSTRATE_CHAINS[chainName as SubstrateChainName];
}

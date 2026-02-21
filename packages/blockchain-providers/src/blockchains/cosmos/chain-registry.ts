import type { CosmosChainConfig } from './chain-config.interface.js';
import cosmosChainsData from './cosmos-chains.json' with { type: 'json' };

/**
 * Registry of all supported Cosmos SDK-based chains
 * Loaded from cosmos-chains.json for easy maintenance
 *
 * Usage:
 * ```typescript
 * const importer = new CosmosImporter(COSMOS_CHAINS.injective, manager);
 * const processor = new CosmosProcessor(COSMOS_CHAINS.osmosis);
 * ```
 */
export const COSMOS_CHAINS = cosmosChainsData as unknown as Record<string, CosmosChainConfig>;

/**
 * Type-safe chain names for all supported Cosmos SDK chains
 */
export type CosmosChainName = keyof typeof COSMOS_CHAINS;

/**
 * Helper to get chain config by name with type safety
 *
 * @param chainName - The chain identifier (e.g., 'injective', 'osmosis', 'cosmoshub')
 * @returns The chain configuration or undefined if not found
 *
 * @public
 */
export function getCosmosChainConfig(chainName: string): CosmosChainConfig | undefined {
  return COSMOS_CHAINS[chainName];
}

/**
 * Get all supported Cosmos chain names
 *
 * @returns Array of all registered chain names
 *
 * @public
 */
export function getAllCosmosChainNames(): string[] {
  return Object.keys(COSMOS_CHAINS);
}

/**
 * Check if a chain is supported
 *
 * @param chainName - The chain identifier to check
 * @returns True if the chain is registered
 *
 * @public
 */
export function isCosmosChainSupported(chainName: string): boolean {
  return chainName in COSMOS_CHAINS;
}

import { defineChainRegistry } from '../shared/chain-registry-utils.js';

import type { CosmosChainConfig } from './chain-config.interface.js';
import cosmosChainsData from './cosmos-chains.json' with { type: 'json' };

/**
 * Registry of configured Cosmos SDK-based chains.
 * Loaded from cosmos-chains.json for easy maintenance.
 *
 * Usage:
 * ```typescript
 * const importer = new CosmosImporter(COSMOS_CHAINS.injective, manager);
 * const processor = new CosmosProcessor(COSMOS_CHAINS.osmosis);
 * ```
 */
export const COSMOS_CHAINS = defineChainRegistry<CosmosChainConfig, typeof cosmosChainsData>(cosmosChainsData);

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
export function getCosmosChainConfig(chainName: CosmosChainName): CosmosChainConfig;
export function getCosmosChainConfig(chainName: string): CosmosChainConfig | undefined;
export function getCosmosChainConfig(chainName: string): CosmosChainConfig | undefined {
  return chainName in COSMOS_CHAINS ? COSMOS_CHAINS[chainName as CosmosChainName] : undefined;
}

/**
 * Get all supported Cosmos chain names
 *
 * @returns Array of all registered chain names
 *
 * @public
 */
export function getAllCosmosChainNames(): CosmosChainName[] {
  return Object.keys(COSMOS_CHAINS) as CosmosChainName[];
}

/**
 * Get Cosmos chains whose account-history import has been verified and should
 * be exposed through provider and ingestion registries.
 *
 * @returns Array of verified account-history chain names
 *
 * @public
 */
export function getCosmosAccountHistoryChainNames(): CosmosChainName[] {
  return getAllCosmosChainNames().filter((chainName) => isCosmosAccountHistorySupported(chainName));
}

/**
 * Check if a chain is configured in the Cosmos registry.
 *
 * This does not imply account-history import is enabled. Use
 * isCosmosAccountHistorySupported for the user-facing import boundary.
 *
 * @param chainName - The chain identifier to check
 * @returns True if the chain is registered in cosmos-chains.json
 *
 * @public
 */
export function isCosmosChainSupported(chainName: string): chainName is CosmosChainName {
  return chainName in COSMOS_CHAINS;
}

/**
 * Check whether a Cosmos chain is enabled for account-history import.
 *
 * @param chainName - The chain identifier to check
 * @returns True if account-history import is verified for this chain
 *
 * @public
 */
export function isCosmosAccountHistorySupported(chainName: string): chainName is CosmosChainName {
  const chainConfig = getCosmosChainConfig(chainName);
  return chainConfig?.accountHistorySupport === 'verified';
}

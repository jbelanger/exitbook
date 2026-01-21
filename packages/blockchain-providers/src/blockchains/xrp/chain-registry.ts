import type { XrpChainConfig } from './chain-config.interface.js';
import xrpChainsData from './xrp-chains.json' with { type: 'json' };

/**
 * Registry of all supported XRP Ledger networks
 * Loaded from xrp-chains.json for easy maintenance
 *
 * Usage:
 * ```typescript
 * const importer = new XrpImporter(XRP_CHAINS.xrp, manager);
 * const processor = new XrpProcessor(XRP_CHAINS.xrp);
 * ```
 */
export const XRP_CHAINS = xrpChainsData as Record<string, XrpChainConfig>;

/**
 * Type-safe chain names for all supported XRP networks
 */
export type XrpChainName = keyof typeof XRP_CHAINS;

/**
 * Helper to get chain config by name with type safety
 *
 * @param chainName - The network identifier (e.g., 'xrp', 'xrp-testnet')
 * @returns The chain configuration or undefined if not found
 *
 * @public
 */
export function getXrpChainConfig(chainName: string): XrpChainConfig | undefined {
  return XRP_CHAINS[chainName];
}

import bitcoinChainsData from './bitcoin-chains.json' with { type: 'json' };
import type { BitcoinChainConfig } from './chain-config.interface.js';

/**
 * Registry of all supported Bitcoin-like UTXO chains
 * Loaded from bitcoin-chains.json for easy maintenance
 *
 * Usage:
 * ```typescript
 * const importer = new BitcoinImporter(BITCOIN_CHAINS.bitcoin, manager);
 * const processor = new BitcoinProcessor(BITCOIN_CHAINS.dogecoin);
 * ```
 */
export const BITCOIN_CHAINS = bitcoinChainsData as Record<string, BitcoinChainConfig>;

/**
 * Type-safe chain names for all supported Bitcoin-like chains
 */
export type BitcoinChainName = keyof typeof BITCOIN_CHAINS;

/**
 * Helper to get chain config by name with type safety
 *
 * @param chainName - The chain identifier (e.g., 'bitcoin', 'dogecoin', 'litecoin')
 * @returns The chain configuration or undefined if not found
 *
 * @public
 */
export function getBitcoinChainConfig(chainName: string): BitcoinChainConfig | undefined {
  return BITCOIN_CHAINS[chainName];
}

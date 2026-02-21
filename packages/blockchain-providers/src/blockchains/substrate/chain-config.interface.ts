import type { Currency } from '@exitbook/core';

/**
 * Configuration interface for Substrate-based blockchains
 *
 * This interface defines the chain-specific configuration needed
 * for Substrate importers and processors to work across multiple chains.
 */
export interface SubstrateChainConfig {
  /**
   * Unique identifier for the blockchain (e.g., 'polkadot', 'bittensor', 'kusama')
   */
  chainName: string;

  /**
   * Display name for the chain (e.g., 'Polkadot Relay Chain', 'Bittensor Network')
   */
  displayName: string;

  /**
   * Symbol for the native currency (e.g., 'DOT', 'TAO', 'KSM')
   */
  nativeCurrency: Currency;

  /**
   * Number of decimals for the native currency (DOT: 10, TAO: 9, KSM: 12)
   */
  nativeDecimals: number;

  /**
   * SS58 address format/prefix for this chain (e.g., 0 for Polkadot, 42 for generic)
   */
  ss58Format: number;

  /**
   * Array of block explorer URLs for this chain
   */
  explorerUrls?: string[] | undefined;
}

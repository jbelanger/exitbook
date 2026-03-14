import type { Currency } from '@exitbook/core';

import type { ChainProviderHints } from '../../catalog/types.js';

/**
 * Configuration interface for EVM-compatible blockchains
 *
 * This interface defines the chain-specific configuration needed
 * for EVM importers and processors to work across multiple chains.
 */
export interface EvmChainConfig {
  /**
   * EVM chain ID (e.g., 1 for Ethereum Mainnet, 43114 for Avalanche C-Chain)
   */
  chainId: number;

  /**
   * Unique identifier for the blockchain (e.g., 'ethereum', 'avalanche')
   */
  chainName: string;

  /**
   * Optional array of block explorer URLs for this chain
   */
  explorerUrls?: string[] | undefined;

  /**
   * Symbol for the native currency (e.g., 'ETH', 'AVAX')
   */
  nativeCurrency: Currency;

  /**
   * Number of decimals for the native currency (typically 18 for EVM chains)
   */
  nativeDecimals: number;

  /**
   * Transaction types supported by this chain.
   * Defines which transaction streams the importer should fetch.
   *
   * Common types:
   * - 'normal': Standard external transactions
   * - 'internal': Internal contract calls
   * - 'token': ERC-20/721/1155 token transfers
   * - 'beacon_withdrawal': Ethereum beacon chain withdrawals (Ethereum mainnet only)
   *
   * @example
   * // Most EVM chains support normal, internal, and token transactions
   * transactionTypes: ['normal', 'internal', 'token']
   *
   * @example
   * // Ethereum mainnet includes beacon withdrawals
   * transactionTypes: ['normal', 'internal', 'token', 'beacon_withdrawal']
   *
   * @example
   * // Chains where only normal transactions are available
   * transactionTypes: ['normal']
   */
  transactionTypes: string[];

  /**
   * Optional provider-specific metadata hints used by aggregate catalogs.
   */
  providerHints?: ChainProviderHints | undefined;
}

import type { Currency } from '@exitbook/core';

/**
 * Configuration interface for XRP Ledger
 *
 * This interface defines the chain-specific configuration needed
 * for XRP importers and processors.
 *
 * XRP Ledger characteristics:
 * - Account-based model (not UTXO)
 * - 6 decimal places for XRP (represented as "drops": 1 XRP = 1,000,000 drops)
 * - Built-in DEX and token support (issued currencies)
 * - Consensus protocol (not proof-of-work)
 */
export interface XrpChainConfig {
  /**
   * Unique identifier for the network (e.g., 'xrp', 'xrp-testnet')
   */
  chainName: string;

  /**
   * Human-readable display name (e.g., 'XRP Ledger', 'XRP Ledger Testnet')
   */
  displayName: string;

  /**
   * Symbol for the native currency (always 'XRP')
   */
  nativeCurrency: Currency;

  /**
   * Number of decimals for the native currency (always 6 for XRP)
   */
  nativeDecimals: number;

  /**
   * Network identifier for the XRP Ledger (mainnet, testnet, devnet)
   */
  network: 'mainnet' | 'testnet' | 'devnet';

  /**
   * Optional array of block explorer URLs for this network
   */
  explorerUrls?: string[] | undefined;

  /**
   * Primary RPC endpoint URL for this network
   */
  rpcUrl: string;

  /**
   * Optional array of additional RPC endpoint URLs for failover
   */
  rpcUrls?: string[] | undefined;
}

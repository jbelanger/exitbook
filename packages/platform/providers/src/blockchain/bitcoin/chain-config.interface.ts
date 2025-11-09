/**
 * Configuration interface for Bitcoin-like UTXO blockchains
 *
 * This interface defines the chain-specific configuration needed
 * for Bitcoin-like importers and processors to work across multiple chains.
 *
 * All Bitcoin-like chains share:
 * - UTXO transaction model
 * - 8 decimal places for native currency
 * - Similar address formats (with different prefixes)
 * - Block-based consensus
 */
export interface BitcoinChainConfig {
  /**
   * Unique identifier for the blockchain (e.g., 'bitcoin', 'dogecoin', 'litecoin')
   */
  chainName: string;

  /**
   * Human-readable display name (e.g., 'Bitcoin', 'Dogecoin', 'Litecoin')
   */
  displayName: string;

  /**
   * Symbol for the native currency (e.g., 'BTC', 'DOGE', 'LTC')
   */
  nativeCurrency: string;

  /**
   * Number of decimals for the native currency (always 8 for Bitcoin-like chains)
   */
  nativeDecimals: number;

  /**
   * Optional array of block explorer URLs for this chain
   */
  explorerUrls?: string[] | undefined;

  /**
   * Optional array of address prefixes for validation
   * e.g., ['1', '3', 'bc1'] for Bitcoin, ['D'] for Dogecoin, ['L', 'M', 'ltc1'] for Litecoin
   */
  addressPrefixes?: string[] | undefined;
}

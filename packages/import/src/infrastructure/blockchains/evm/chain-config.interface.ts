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
  explorerUrls?: string[];

  /**
   * Symbol for the native currency (e.g., 'ETH', 'AVAX')
   */
  nativeCurrency: string;

  /**
   * Number of decimals for the native currency (typically 18 for EVM chains)
   */
  nativeDecimals: number;
}

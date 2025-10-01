import type { EvmChainConfig } from '../evm/chain-config.interface.js';

/**
 * Ethereum Mainnet configuration
 */
export const ETHEREUM_CONFIG: EvmChainConfig = {
  chainId: 1,
  chainName: 'ethereum',
  explorerUrls: ['https://etherscan.io'],
  nativeCurrency: 'ETH',
  nativeDecimals: 18,
};

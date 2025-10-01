import type { EvmChainConfig } from '../evm/chain-config.interface.js';

/**
 * Avalanche C-Chain configuration
 */
export const AVALANCHE_CONFIG: EvmChainConfig = {
  chainId: 43114,
  chainName: 'avalanche',
  explorerUrls: ['https://snowtrace.io'],
  nativeCurrency: 'AVAX',
  nativeDecimals: 18,
};

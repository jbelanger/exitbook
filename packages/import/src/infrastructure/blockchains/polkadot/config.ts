import type { SubstrateChainConfig } from '../substrate/chain-config.interface.js';

/**
 * Polkadot Mainnet configuration
 */
export const POLKADOT_CONFIG: SubstrateChainConfig = {
  chainName: 'polkadot',
  displayName: 'Polkadot Relay Chain',
  explorerUrls: ['https://polkadot.subscan.io', 'https://polkadot.js.org/apps'],
  genesisHash: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
  nativeCurrency: 'DOT',
  nativeDecimals: 10,
  ss58Format: 0,
};

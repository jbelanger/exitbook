import type { SubstrateChainConfig } from '../substrate/chain-config.interface.js';

/**
 * Bittensor Mainnet configuration
 */
export const BITTENSOR_CONFIG: SubstrateChainConfig = {
  chainName: 'bittensor',
  displayName: 'Bittensor Network',
  explorerUrls: ['https://taostats.io', 'https://bittensor.com/scan'],
  genesisHash: '0x5c0d1176a568c1f92944340dbfed9e9c530ebca703c85910e7164cb7d1c9e47b',
  nativeCurrency: 'TAO',
  nativeDecimals: 9,
  ss58Format: 42,
};

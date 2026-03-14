import type { Currency } from '@exitbook/core';

import type { NearChainConfig } from './chain-config.interface.js';

export const NEAR_CHAINS: Record<string, NearChainConfig> = {
  near: {
    chainName: 'near',
    nativeCurrency: 'NEAR' as Currency,
    nativeDecimals: 24,
    providerHints: {
      coingecko: {
        platformId: 'near-protocol',
        tokenRefFormat: 'platform-address',
      },
    },
  },
};

export function getNearChainConfig(chainName: string): NearChainConfig | undefined {
  return NEAR_CHAINS[chainName];
}

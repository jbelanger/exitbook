import type { Currency } from '@exitbook/core';

import type { CardanoChainConfig } from './chain-config.interface.js';

export const CARDANO_CHAINS: Record<string, CardanoChainConfig> = {
  cardano: {
    chainName: 'cardano',
    nativeCurrency: 'ADA' as Currency,
    nativeDecimals: 6,
    providerHints: {
      coingecko: {
        platformId: 'cardano',
        tokenRefFormat: 'platform-address',
      },
    },
  },
};

export function getCardanoChainConfig(chainName: string): CardanoChainConfig | undefined {
  return CARDANO_CHAINS[chainName];
}

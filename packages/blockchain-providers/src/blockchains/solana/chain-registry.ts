import type { Currency } from '@exitbook/foundation';

import type { SolanaChainConfig } from './chain-config.interface.js';

export const SOLANA_CHAINS: Record<string, SolanaChainConfig> = {
  solana: {
    chainName: 'solana',
    nativeCurrency: 'SOL' as Currency,
    nativeDecimals: 9,
    providerHints: {
      coingecko: {
        platformId: 'solana',
        tokenRefFormat: 'platform-address',
      },
    },
  },
};

export function getSolanaChainConfig(chainName: string): SolanaChainConfig | undefined {
  return SOLANA_CHAINS[chainName];
}

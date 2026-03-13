import type { Currency } from '@exitbook/core';

import type { ChainProviderHints } from '../../catalog/types.js';

export interface SolanaChainConfig {
  chainName: string;
  nativeCurrency: Currency;
  nativeDecimals: number;
  providerHints?: ChainProviderHints | undefined;
}

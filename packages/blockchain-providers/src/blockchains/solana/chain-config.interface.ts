import type { Currency } from '@exitbook/core';

import type { BlockchainProviderHints } from '../../catalog/types.js';

export interface SolanaChainConfig {
  chainName: string;
  nativeCurrency: Currency;
  nativeDecimals: number;
  providerHints?: BlockchainProviderHints | undefined;
}

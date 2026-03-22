import type { Currency } from '@exitbook/foundation';

import type { ChainProviderHints } from '../../catalog/types.js';

export interface ThetaNativeAssetConfig {
  decimals: number;
  role: 'gas' | 'primary';
  symbol: Currency;
}

export interface ThetaChainConfig {
  chainName: 'theta';
  explorerUrls?: string[] | undefined;
  nativeAssets: ThetaNativeAssetConfig[];
  providerHints?: ChainProviderHints | undefined;
  transactionTypes: string[];
}

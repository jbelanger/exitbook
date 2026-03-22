import type { Currency } from '@exitbook/foundation';

import type { ChainProviderHints } from '../../catalog/types.js';

export interface NearChainConfig {
  chainName: string;
  nativeCurrency: Currency;
  nativeDecimals: number;
  providerHints?: ChainProviderHints | undefined;
}

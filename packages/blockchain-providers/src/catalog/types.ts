export type CoinGeckoTokenRefFormat = 'evm-contract' | 'platform-address' | 'unsupported';

export interface CoinGeckoChainHints {
  chainIdentifier?: number | undefined;
  platformId?: string | undefined;
  tokenRefFormat?: CoinGeckoTokenRefFormat | undefined;
}

export interface ChainProviderHints {
  coingecko?: CoinGeckoChainHints | undefined;
}

export interface ChainCatalogEntry {
  chainName: string;
  providerHints?: ChainProviderHints | undefined;
}

export interface CoinGeckoChainHints {
  chainIdentifier?: number | undefined;
  platformId?: string | undefined;
}

export interface ChainProviderHints {
  coingecko?: CoinGeckoChainHints | undefined;
}

export interface ChainCatalogEntry {
  chainName: string;
  providerHints?: ChainProviderHints | undefined;
}

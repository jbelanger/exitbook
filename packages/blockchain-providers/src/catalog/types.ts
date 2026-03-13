export interface CoinGeckoBlockchainHints {
  chainIdentifier?: number | undefined;
  platformId?: string | undefined;
}

export interface BlockchainProviderHints {
  coingecko?: CoinGeckoBlockchainHints | undefined;
}

export interface BlockchainCatalogEntry {
  chainName: string;
  providerHints?: BlockchainProviderHints | undefined;
}

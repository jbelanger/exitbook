// Currency entity placeholder
export interface CurrencyEntity {
  assetClass: 'CRYPTO' | 'FIAT' | 'NFT' | 'STOCK';
  contractAddress?: string;
  createdAt: Date;
  decimals: number;
  id: number;
  isNative: boolean;
  name: string;
  network?: string;
  ticker: string;
}

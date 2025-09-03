// Currency entity placeholder
export interface CurrencyEntity {
  id: number;
  ticker: string;
  name: string;
  decimals: number;
  assetClass: 'CRYPTO' | 'FIAT' | 'NFT' | 'STOCK';
  network?: string;
  contractAddress?: string;
  isNative: boolean;
  createdAt: Date;
}
import { Data } from 'effect';

export enum AssetType {
  CRYPTO = 'CRYPTO',
  FIAT = 'FIAT',
  LP_TOKEN = 'LP_TOKEN',
  NFT = 'NFT',
}

export class AssetId extends Data.Class<{
  readonly blockchain?: string;
  readonly contractAddress?: string;
  readonly symbol: string;
  readonly type: AssetType;
}> {
  static crypto(symbol: string, blockchain: string, contractAddress?: string): AssetId {
    const base = {
      blockchain,
      symbol: symbol.toUpperCase(),
      type: AssetType.CRYPTO,
    };
    return new AssetId(
      contractAddress ? { ...base, contractAddress } : base
    );
  }

  static fiat(symbol: string): AssetId {
    return new AssetId({
      symbol: symbol.toUpperCase(),
      type: AssetType.FIAT,
    });
  }

  static nft(symbol: string, blockchain: string, contractAddress: string): AssetId {
    return new AssetId({
      blockchain,
      contractAddress,
      symbol: symbol.toUpperCase(),
      type: AssetType.NFT,
    });
  }

  static lpToken(symbol: string, blockchain: string, contractAddress: string): AssetId {
    return new AssetId({
      blockchain,
      contractAddress,
      symbol: symbol.toUpperCase(),
      type: AssetType.LP_TOKEN,
    });
  }

  override toString(): string {
    return this.blockchain ? `${this.symbol}@${this.blockchain}` : this.symbol;
  }
}
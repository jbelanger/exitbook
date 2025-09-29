// Alchemy API response types
export interface AlchemyAssetTransferParams {
  category: string[];
  contractAddresses?: string[];
  excludeZeroValue: boolean;
  fromAddress?: string;
  fromBlock?: string;
  maxCount: string;
  order?: string;
  pageKey?: string;
  toAddress?: string;
  toBlock?: string;
  withMetadata: boolean;
}

export interface AlchemyAssetTransfer {
  asset?: string;
  blockNum: string;
  category: string;
  erc1155Metadata?: {
    tokenId?: string;
    value?: string;
  }[];
  from: string;
  hash: string;
  metadata?: {
    blockTimestamp?: string;
  };
  rawContract?: {
    address?: string;
    decimal?: string;
  };
  to: string;
  value: string;
}

export interface AlchemyAssetTransfersResponse {
  pageKey?: string;
  transfers: AlchemyAssetTransfer[];
}

export interface AlchemyTokenBalance {
  contractAddress: string;
  error?: string;
  tokenBalance: string;
}

export interface AlchemyTokenBalancesResponse {
  address: string;
  tokenBalances: AlchemyTokenBalance[];
}

export interface AlchemyTokenMetadata {
  decimals: number;
  logo?: string;
  name?: string;
  symbol?: string;
}

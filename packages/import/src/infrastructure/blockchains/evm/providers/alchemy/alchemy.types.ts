// Alchemy API response types
export interface AlchemyAssetTransferParams {
  category: string[];
  contractAddresses?: string[] | undefined;
  excludeZeroValue: boolean;
  fromAddress?: string | undefined;
  fromBlock?: string | undefined;
  maxCount: string;
  order?: string | undefined;
  pageKey?: string | undefined;
  toAddress?: string | undefined;
  toBlock?: string | undefined;
  withMetadata: boolean;
}

export interface AlchemyAssetTransfer {
  asset?: string | undefined;
  blockNum: string;
  category: string;
  erc1155Metadata?: {
    tokenId?: string | undefined;
    value?: string | undefined;
  }[];
  erc721TokenId?: string | undefined;
  from: string;
  hash: string;
  metadata?: {
    blockTimestamp?: string | undefined;
  };
  rawContract?: {
    address?: string | undefined;
    decimal?: string | number | undefined;
    value?: string | number | undefined;
  };
  to: string;
  tokenId?: string | undefined;
  uniqueId?: string | undefined;
  value?: string | number | undefined;
}

export interface AlchemyAssetTransfersResponse {
  pageKey?: string | undefined;
  transfers: AlchemyAssetTransfer[];
}

export interface AlchemyTokenBalance {
  contractAddress: string;
  error?: string | undefined;
  tokenBalance: string;
}

export interface AlchemyTokenBalancesResponse {
  address: string;
  tokenBalances: AlchemyTokenBalance[];
}

export interface AlchemyTokenMetadata {
  decimals: number;
  logo?: string | undefined;
  name?: string | undefined;
  symbol?: string | undefined;
}

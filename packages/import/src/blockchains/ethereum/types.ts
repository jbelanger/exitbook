// Ethereum and EVM blockchain adapter types

export interface EtherscanTransaction {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  nonce: string;
  blockHash: string;
  transactionIndex: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  cumulativeGasUsed: string;
  input: string;
  confirmations: string;
  isError?: string;
  txreceipt_status?: string;
  functionName?: string;
  methodId?: string;
}

export interface EtherscanInternalTransaction {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  input: string;
  type: string;
  gas: string;
  gasUsed: string;
  traceId: string;
  isError: string;
  errCode: string;
}

export interface EtherscanTokenTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  nonce: string;
  blockHash: string;
  from: string;
  contractAddress: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  transactionIndex: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  cumulativeGasUsed: string;
  input: string;
  confirmations: string;
}

export interface EtherscanApiResponse<T> {
  status: string;
  message: string;
  result: T[];
}

export interface EtherscanBalance {
  account: string;
  balance: string;
}

export interface EtherscanTokenBalance {
  TokenAddress: string;
  TokenName: string;
  TokenSymbol: string;
  TokenQuantity: string;
  TokenDivisor: string;
}

// Generic Etherscan API response wrapper
export interface EtherscanResponse<T = unknown> {
  status: string;
  message: string;
  result: T;
}

// Moralis API response types
export interface MoralisTransaction {
  hash: string;
  nonce: string;
  transaction_index: string;
  from_address: string;
  to_address: string;
  value: string;
  gas: string;
  gas_price: string;
  input: string;
  receipt_cumulative_gas_used: string;
  receipt_gas_used: string;
  receipt_contract_address: string | null;
  receipt_root: string;
  receipt_status: string;
  block_timestamp: string;
  block_number: string;
  block_hash: string;
}

export interface MoralisTokenTransfer {
  transaction_hash: string;
  address: string;
  block_timestamp: string;
  block_number: string;
  block_hash: string;
  to_address: string;
  from_address: string;
  value: string;
  token_name: string;
  token_symbol: string;
  token_logo: string;
  token_decimals: string;
  contract_type: string;
}

export interface MoralisNativeBalance {
  balance: string;
}

export interface MoralisDateToBlockResponse {
  block: number;
}

export interface MoralisTransactionResponse {
  result: MoralisTransaction[];
}

export interface MoralisTokenTransferResponse {
  result: MoralisTokenTransfer[];
}

export interface MoralisTokenBalance {
  token_address: string;
  name: string;
  symbol: string;
  logo?: string;
  decimals: number;
  balance: string;
}

// Alchemy API response types
export interface AlchemyAssetTransferParams {
  fromAddress?: string;
  toAddress?: string;
  category: string[];
  withMetadata: boolean;
  excludeZeroValue: boolean;
  maxCount: string;
  order?: string;
  contractAddresses?: string[];
}


export interface AlchemyAssetTransfer {
  from: string;
  to: string;
  value: string;
  blockNum: string;
  hash: string;
  category: string;
  asset?: string;
  rawContract?: {
    address?: string;
    decimal?: string;
  };
  metadata?: {
    blockTimestamp?: string;
  };
}

export interface AlchemyAssetTransfersResponse {
  transfers: AlchemyAssetTransfer[];
  pageKey?: string;
}

export interface AlchemyTokenBalance {
  contractAddress: string;
  tokenBalance: string;
  error?: string;
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

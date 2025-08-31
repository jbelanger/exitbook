// Ethereum and EVM blockchain adapter types

// Common JSON-RPC response interface for Ethereum providers
export interface JsonRpcResponse<T = unknown> {
  error?: { code: number; message: string };
  id?: number | string;
  jsonrpc?: string;
  result: T;
}

export interface EtherscanTransaction {
  blockHash: string;
  blockNumber: string;
  confirmations: string;
  cumulativeGasUsed: string;
  from: string;
  functionName?: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  hash: string;
  input: string;
  isError?: string;
  methodId?: string;
  nonce: string;
  timeStamp: string;
  to: string;
  transactionIndex: string;
  txreceipt_status?: string;
  value: string;
}

export interface EtherscanInternalTransaction {
  blockNumber: string;
  contractAddress: string;
  errCode: string;
  from: string;
  gas: string;
  gasUsed: string;
  hash: string;
  input: string;
  isError: string;
  timeStamp: string;
  to: string;
  traceId: string;
  type: string;
  value: string;
}

export interface EtherscanTokenTransfer {
  blockHash: string;
  blockNumber: string;
  confirmations: string;
  contractAddress: string;
  cumulativeGasUsed: string;
  from: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  hash: string;
  input: string;
  nonce: string;
  timeStamp: string;
  to: string;
  tokenDecimal: string;
  tokenName: string;
  tokenSymbol: string;
  transactionIndex: string;
  value: string;
}

export interface EtherscanApiResponse<T> {
  message: string;
  result: T[];
  status: string;
}

export interface EtherscanBalance {
  account: string;
  balance: string;
}

export interface EtherscanTokenBalance {
  TokenAddress: string;
  TokenDivisor: string;
  TokenName: string;
  TokenQuantity: string;
  TokenSymbol: string;
}

// Generic Etherscan API response wrapper
export interface EtherscanResponse<T = unknown> {
  message: string;
  result: T;
  status: string;
}

// Moralis API response types
export interface MoralisTransaction {
  block_hash: string;
  block_number: string;
  block_timestamp: string;
  from_address: string;
  gas: string;
  gas_price: string;
  hash: string;
  input: string;
  nonce: string;
  receipt_contract_address: string | null;
  receipt_cumulative_gas_used: string;
  receipt_gas_used: string;
  receipt_root: string;
  receipt_status: string;
  to_address: string;
  transaction_index: string;
  value: string;
}

export interface MoralisTokenTransfer {
  address: string;
  block_hash: string;
  block_number: string;
  block_timestamp: string;
  contract_type: string;
  from_address: string;
  to_address: string;
  token_decimals: string;
  token_logo: string;
  token_name: string;
  token_symbol: string;
  transaction_hash: string;
  value: string;
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
  balance: string;
  decimals: number;
  logo?: string;
  name: string;
  symbol: string;
  token_address: string;
}

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
  erc1155Metadata?: Array<{
    tokenId?: string;
    value?: string;
  }>;
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

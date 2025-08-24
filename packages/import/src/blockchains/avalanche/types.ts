// Avalanche C-Chain specific types and interfaces

export interface SnowtraceTransaction {
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

export interface SnowtraceInternalTransaction {
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

export interface SnowtraceTokenTransfer {
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

export interface SnowtraceApiResponse<T> {
  status: string;
  message: string;
  result: T[];
}

export interface SnowtraceBalanceResponse {
  status: string;
  message: string;
  result: string;
}

export interface SnowtraceBalance {
  account: string;
  balance: string;
}

export interface SnowtraceTokenBalance {
  TokenAddress: string;
  TokenName: string;
  TokenSymbol: string;
  TokenQuantity: string;
  TokenDivisor: string;
}

// Avalanche-specific atomic transaction types
export interface AtomicTransaction {
  id: string;
  timestamp: string;
  type: 'import' | 'export';
  sourceChain: 'P' | 'X' | 'C';
  destinationChain: 'P' | 'X' | 'C';
  amount: string;
  asset: string;
  fee: string;
  status: 'accepted' | 'processing' | 'rejected';
}

// Network configuration for Avalanche C-Chain
export interface AvalancheNetwork {
  name: string;
  chainId: number;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  apiUrl: string;
  apiKey?: string;
}

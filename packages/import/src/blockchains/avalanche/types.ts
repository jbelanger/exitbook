// Avalanche C-Chain specific types and interfaces

export interface SnowtraceTransaction {
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

export interface SnowtraceInternalTransaction {
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

export interface SnowtraceTokenTransfer {
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

export interface SnowtraceApiResponse<T> {
  message: string;
  result: T[];
  status: string;
}

export interface SnowtraceBalanceResponse {
  message: string;
  result: string;
  status: string;
}

export interface SnowtraceBalance {
  account: string;
  balance: string;
}

export interface SnowtraceTokenBalance {
  TokenAddress: string;
  TokenDivisor: string;
  TokenName: string;
  TokenQuantity: string;
  TokenSymbol: string;
}

// Avalanche-specific atomic transaction types
export interface AtomicTransaction {
  amount: string;
  asset: string;
  destinationChain: 'P' | 'X' | 'C';
  fee: string;
  id: string;
  sourceChain: 'P' | 'X' | 'C';
  status: 'accepted' | 'processing' | 'rejected';
  timestamp: string;
  type: 'import' | 'export';
}

// Network configuration for Avalanche C-Chain
export interface AvalancheNetwork {
  apiKey?: string;
  apiUrl: string;
  blockExplorerUrls: string[];
  chainId: number;
  name: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  rpcUrls: string[];
}

// Transaction correlation types
export interface TransactionGroup {
  hash: string;
  internal?: SnowtraceInternalTransaction[];
  normal?: SnowtraceTransaction;
  timestamp: number;
  tokens?: SnowtraceTokenTransfer[];
  userAddress: string;
}

export interface ClassificationResult {
  assets: {
    amount: string;
    direction: 'in' | 'out';
    symbol: string;
  }[];
  primaryAmount: string;
  primarySymbol: string;
  reason: string;
  type: 'deposit' | 'withdrawal' | 'trade' | 'fee';
}

export interface ValueFlow {
  amountIn: string;
  amountOut: string;
  netFlow: string;
  symbol: string;
}

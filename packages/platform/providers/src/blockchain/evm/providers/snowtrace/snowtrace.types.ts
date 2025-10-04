// Avalanche C-Chain specific types and interfaces

export interface SnowtraceTransaction {
  blockHash: string;
  blockNumber: string;
  confirmations: string;
  cumulativeGasUsed: string;
  from: string;
  functionName?: string | undefined;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  hash: string;
  input: string;
  isError?: string | undefined;
  methodId?: string | undefined;
  nonce: string;
  timeStamp: Date;
  to: string;
  transactionIndex: string;
  txreceipt_status?: string | undefined;
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
  timeStamp: Date;
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
  timeStamp: Date;
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

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

export const AVALANCHE_NETWORKS: { [key: string]: AvalancheNetwork } = {
  mainnet: {
    name: 'Avalanche C-Chain',
    chainId: 43114,
    nativeCurrency: {
      name: 'Avalanche',
      symbol: 'AVAX',
      decimals: 18
    },
    rpcUrls: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://rpc.ankr.com/avalanche'
    ],
    blockExplorerUrls: ['https://snowtrace.io'],
    apiUrl: 'https://api.snowtrace.io/api'
  },
  testnet: {
    name: 'Avalanche Fuji Testnet',
    chainId: 43113,
    nativeCurrency: {
      name: 'Avalanche',
      symbol: 'AVAX',
      decimals: 18
    },
    rpcUrls: [
      'https://api.avax-test.network/ext/bc/C/rpc'
    ],
    blockExplorerUrls: ['https://testnet.snowtrace.io'],
    apiUrl: 'https://api-testnet.snowtrace.io/api'
  }
};

// Avalanche address validation
export function isValidAvalancheAddress(address: string): boolean {
  // Avalanche C-Chain uses Ethereum-style addresses but they are case-sensitive
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return ethAddressRegex.test(address);
}

// Convert address to checksum (important for Avalanche case-sensitivity)
export function toChecksumAddress(address: string): string {
  // Basic implementation - in production you'd want to use a proper checksum library
  if (!isValidAvalancheAddress(address)) {
    throw new Error('Invalid Avalanche address format');
  }
  return address; // For now, return as-is, but in production implement proper checksumming
}
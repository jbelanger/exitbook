// Common JSON-RPC response interface for blockchain providers
export interface JsonRpcResponse<T = unknown> {
  error?: { code: number; message: string };
  id?: number | string;
  jsonrpc?: string;
  result: T;
}

// Provider-specific operation types for capabilities
export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalance'
  | 'getTokenTransactions'
  | 'getTokenBalances'
  | 'getRawAddressTransactions'
  | 'getRawAddressInternalTransactions'
  | 'getRawAddressBalance'
  | 'getRawTokenBalances'
  | 'getAddressInfo'
  | 'custom';

export interface ProviderCapabilities {
  /** Array of operation types that this data source supports */
  supportedOperations: ProviderOperationType[];
}

export interface ProviderHealth {
  averageResponseTime: number;
  consecutiveFailures: number;
  errorRate: number;
  isHealthy: boolean;
  lastChecked: number;
  lastError?: string | undefined;
}

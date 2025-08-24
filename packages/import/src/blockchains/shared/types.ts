import type { DataSourceCapabilities, RateLimitConfig } from '@crypto/core';

// Parameter interfaces removed - discriminated union provides type safety

// Discriminated union type for all possible operation parameters
export type ProviderOperationParams =
  | {
      type: 'getAddressTransactions';
      address: string;
      since?: number | undefined;
      until?: number | undefined;
      limit?: number | undefined;
    }
  | {
      type: 'getRawAddressTransactions';
      address: string;
      since?: number | undefined;
      until?: number | undefined;
      limit?: number | undefined;
    }
  | { type: 'getAddressBalance'; address: string; contractAddresses?: string[] | undefined }
  | {
      type: 'getTokenTransactions';
      address: string;
      contractAddress?: string | undefined;
      since?: number | undefined;
      until?: number | undefined;
      limit?: number | undefined;
    }
  | { type: 'getTokenBalances'; address: string; contractAddresses?: string[] | undefined }
  | { type: 'getAddressInfo'; address: string }
  | { type: 'parseWalletTransaction'; tx: unknown; walletAddresses: string[] }
  | { type: 'testConnection' }
  | { type: 'custom'; [key: string]: unknown };

// Type guard functions removed - discriminated union provides automatic type narrowing

// Common JSON-RPC response interface for blockchain providers
export interface JsonRpcResponse<T = unknown> {
  result: T;
  error?: { code: number; message: string };
  id?: number | string;
  jsonrpc?: string;
}

export interface IBlockchainProvider<TConfig = Record<string, unknown>> {
  readonly name: string;
  readonly blockchain: string;
  readonly capabilities: ProviderCapabilities;
  readonly rateLimit: RateLimitConfig;

  // Health and connectivity
  isHealthy(): Promise<boolean>;
  testConnection(): Promise<boolean>;

  // Universal execution method - all operations go through this
  execute<T>(operation: ProviderOperation<T>, config: TConfig): Promise<T>;
}

export type ProviderOperation<T> = {
  transform?: (response: unknown) => T;
  getCacheKey?: (params: ProviderOperationParams) => string;
} & ProviderOperationParams;

// Provider-specific operation types for capabilities
export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalance'
  | 'getTokenTransactions'
  | 'getTokenBalances'
  | 'getRawAddressTransactions'
  | 'getAddressInfo'
  | 'parseWalletTransaction';

export interface ProviderCapabilities extends DataSourceCapabilities<ProviderOperationType> {
  /** Whether the provider supports real-time data access */
  supportsRealTimeData: boolean;

  /** Whether the provider supports token-specific operations */
  supportsTokenData: boolean;
}

export interface ProviderHealth {
  isHealthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
  averageResponseTime: number;
  errorRate: number;
  lastError?: string | undefined;
  rateLimitEvents: number; // Total rate limit events encountered
  rateLimitRate: number; // Percentage of requests that were rate limited (0-1)
  lastRateLimitTime?: number | undefined; // Timestamp of last rate limit event
}

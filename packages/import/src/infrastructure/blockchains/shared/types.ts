import type { DataSourceCapabilities } from '@exitbook/core';
import type { RateLimitConfig } from '@exitbook/shared-utils';

// Discriminated union type for all possible operation parameters
export type ProviderOperationParams =
  | {
      address: string;
      limit?: number | undefined;
      since?: number | undefined;
      type: 'getAddressTransactions';
      until?: number | undefined;
    }
  | {
      address: string;
      limit?: number | undefined;
      since?: number | undefined;
      type: 'getRawAddressTransactions';
      until?: number | undefined;
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressBalance' }
  | {
      address: string;
      contractAddress?: string | undefined;
      limit?: number | undefined;
      since?: number | undefined;
      type: 'getTokenTransactions';
      until?: number | undefined;
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getTokenBalances' }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getRawAddressBalance' }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getRawTokenBalances' }
  | { address: string; type: 'getAddressInfo' }
  | { [key: string]: unknown; type: 'custom' };

// Discriminated union provides automatic type narrowing

// Common JSON-RPC response interface for blockchain providers
export interface JsonRpcResponse<T = unknown> {
  error?: { code: number; message: string };
  id?: number | string;
  jsonrpc?: string;
  result: T;
}

export interface IBlockchainProvider<TConfig = Record<string, unknown>> {
  readonly blockchain: string;
  readonly capabilities: ProviderCapabilities;
  // Universal execution method - all operations go through this
  execute<T>(operation: ProviderOperation<T>, config: TConfig): Promise<T>;
  // Health and connectivity
  isHealthy(): Promise<boolean>;

  readonly name: string;
  readonly rateLimit: RateLimitConfig;
}

export type ProviderOperation<T> = {
  getCacheKey?: (params: ProviderOperationParams) => string;
  transform?: (response: unknown) => T;
} & ProviderOperationParams;

// Provider-specific operation types for capabilities
export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalance'
  | 'getTokenTransactions'
  | 'getTokenBalances'
  | 'getRawAddressTransactions'
  | 'getRawAddressBalance'
  | 'getRawTokenBalances'
  | 'getAddressInfo'
  | 'custom';

export interface ProviderCapabilities extends DataSourceCapabilities<ProviderOperationType> {
  /** Whether the provider supports real-time data access */
  supportsRealTimeData: boolean;

  /** Whether the provider supports token-specific operations */
  supportsTokenData: boolean;
}

export interface ProviderHealth {
  averageResponseTime: number;
  consecutiveFailures: number;
  errorRate: number;
  isHealthy: boolean;
  lastChecked: number;
  lastError?: string | undefined;
  lastRateLimitTime?: number | undefined; // Timestamp of last rate limit event
  rateLimitEvents: number; // Total rate limit events encountered
  rateLimitRate: number; // Percentage of requests that were rate limited (0-1)
}

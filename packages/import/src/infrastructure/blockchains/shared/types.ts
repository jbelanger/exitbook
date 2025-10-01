import type { RateLimitConfig } from '@exitbook/shared-utils';
import type { Result } from 'neverthrow';

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
  | {
      address: string;
      limit?: number | undefined;
      since?: number | undefined;
      type: 'getRawAddressInternalTransactions';
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
  // Rate limit benchmarking
  benchmarkRateLimit(
    maxRequestsPerSecond: number,
    numRequestsPerTest: number,
    testBurstLimits?: boolean,
    customRates?: number[]
  ): Promise<{
    burstLimits?: { limit: number; success: boolean }[];
    maxSafeRate: number;
    recommended: RateLimitConfig;
    testResults: { rate: number; responseTimeMs?: number; success: boolean }[];
  }>;
  readonly blockchain: string;
  readonly capabilities: ProviderCapabilities;
  // Universal execution method - all operations go through this
  execute<T>(operation: ProviderOperation<T>, config: TConfig): Promise<T>;
  // Health and connectivity - returns Result to allow special error handling (e.g., RateLimitError)
  isHealthy(): Promise<Result<boolean, Error>>;

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

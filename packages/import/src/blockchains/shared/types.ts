import type { DataSourceCapabilities, RateLimitConfig } from '@crypto/core';

// Provider operation parameter types
export interface AddressTransactionParams {
  address: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface AddressBalanceParams {
  address: string;
  contractAddresses?: string[];
}

export interface TokenTransactionParams {
  address: string;
  contractAddress?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface AddressInfoParams {
  address: string;
}

export interface ParseWalletTransactionParams {
  tx: unknown;
  walletAddresses: string[];
}

// Union type for all possible operation parameters
export type ProviderOperationParams = 
  | AddressTransactionParams 
  | AddressBalanceParams 
  | TokenTransactionParams 
  | AddressInfoParams
  | ParseWalletTransactionParams
  | Record<string, unknown>; // fallback for custom operations

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

export interface ProviderOperation<T> {
  type: 'getAddressTransactions' | 'getAddressBalance' | 'getTokenTransactions' | 'getTokenBalances' | 'getRawAddressTransactions' | 'getAddressInfo' | 'parseWalletTransaction' | 'testConnection' | 'custom';
  params: ProviderOperationParams;
  transform?: (response: unknown) => T;
  getCacheKey?: (params: ProviderOperationParams) => string; // For request-scoped caching
}

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
  rateLimitEvents: number;           // Total rate limit events encountered
  rateLimitRate: number;             // Percentage of requests that were rate limited (0-1)
  lastRateLimitTime?: number | undefined;     // Timestamp of last rate limit event
}
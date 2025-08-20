import type { RateLimitConfig, DataSourceCapabilities } from '@crypto/core';

export interface IBlockchainProvider<TConfig = any> {
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
  params: Record<string, any>;
  transform?: (response: any) => T;
  getCacheKey?: (params: Record<string, any>) => string; // For request-scoped caching
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
  lastError?: string;
  rateLimitEvents: number;           // Total rate limit events encountered
  rateLimitRate: number;             // Percentage of requests that were rate limited (0-1)
  lastRateLimitTime?: number;        // Timestamp of last rate limit event
}
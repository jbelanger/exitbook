import type { RateLimitConfig } from '@crypto/core';

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

export interface ProviderCapabilities {
  supportedOperations: ('getAddressTransactions' | 'getAddressBalance' | 'getTokenTransactions' | 'getTokenBalances' | 'getRawAddressTransactions' | 'getAddressInfo' | 'parseWalletTransaction')[];
  maxBatchSize?: number; // For batch operations
  providesHistoricalData: boolean;
  supportsPagination: boolean;
  maxLookbackDays?: number; // Historical data limit
  supportsRealTimeData: boolean;
  supportsTokenData: boolean;
}
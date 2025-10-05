import type { RateLimitConfig } from '@exitbook/platform-http';
import type { Result } from 'neverthrow';

import type { ProviderOperation, ProviderOperationType } from './operations.js';

export interface ProviderCapabilities {
  /** Array of operation types that this data source supports */
  supportedOperations: ProviderOperationType[];
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
  execute<T>(operation: ProviderOperation, config: TConfig): Promise<T>;
  // Health and connectivity - returns Result to allow special error handling (e.g., RateLimitError)
  isHealthy(): Promise<Result<boolean, Error>>;

  readonly name: string;
  readonly rateLimit: RateLimitConfig;
}

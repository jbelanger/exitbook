import type { CursorState } from '@exitbook/core';

export type ProviderOperationParams =
  | {
      address: string;
      limit?: number | undefined;
      type: 'getAddressTransactions';
    }
  | {
      address: string;
      limit?: number | undefined;
      type: 'getAddressInternalTransactions';
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressBalances' }
  | { address: string; type: 'hasAddressTransactions' }
  | {
      address: string;
      contractAddress?: string | undefined;
      limit?: number | undefined;
      type: 'getAddressTokenTransactions';
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressTokenBalances' }
  | { contractAddresses: string[]; type: 'getTokenMetadata' }
  | { address: string; limit?: number | undefined; type: 'getAddressBeaconWithdrawals' }
  | { address: string; type: 'getAddressInfo' };

export type ProviderOperation = {
  getCacheKey?: (params: ProviderOperationParams) => string;
} & ProviderOperationParams;

// Typed subsets that preserve getCacheKey support
type StreamingOperationParams = Extract<
  ProviderOperationParams,
  | { type: 'getAddressTransactions' }
  | { type: 'getAddressInternalTransactions' }
  | { type: 'getAddressTokenTransactions' }
  | { type: 'getAddressBeaconWithdrawals' }
>;

type OneShotOperationParams = Exclude<ProviderOperationParams, StreamingOperationParams>;

export type StreamingOperation = {
  getCacheKey?: (params: ProviderOperationParams) => string;
} & StreamingOperationParams;
export type OneShotOperation = { getCacheKey?: (params: ProviderOperationParams) => string } & OneShotOperationParams;

export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalances'
  | 'hasAddressTransactions'
  | 'getAddressTokenTransactions'
  | 'getAddressTokenBalances'
  | 'getAddressInternalTransactions'
  | 'getTokenMetadata'
  | 'getAddressBeaconWithdrawals'
  | 'getAddressInfo';

/**
 * Result from failover execution that includes provenance
 */
export interface FailoverExecutionResult<T> {
  data: T;
  providerName: string;
}

/**
 * Statistics about batch processing
 */
export interface BatchStats {
  /**
   * Number of items fetched from provider
   */
  fetched: number;

  /**
   * Number of items filtered by in-memory deduplication
   */
  deduplicated: number;

  /**
   * Number of items yielded to caller (fetched - deduplicated)
   */
  yielded: number;
}

/**
 * Result from streaming failover execution with cursor state
 * Used by executeWithFailover to yield batches with provenance and cursor
 */
export interface FailoverStreamingExecutionResult<T> {
  data: T[];
  providerName: string;
  cursor: CursorState;
  isComplete: boolean;
  stats: BatchStats;
}

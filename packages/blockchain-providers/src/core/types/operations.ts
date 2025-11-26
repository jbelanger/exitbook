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
  | { contractAddress: string; type: 'getTokenMetadata' };

export type ProviderOperation = {
  getCacheKey?: (params: ProviderOperationParams) => string;
} & ProviderOperationParams;

// Typed subsets that preserve getCacheKey support
type StreamingOperationParams = Extract<
  ProviderOperationParams,
  | { type: 'getAddressTransactions' }
  | { type: 'getAddressInternalTransactions' }
  | { type: 'getAddressTokenTransactions' }
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
  | 'getTokenMetadata';

/**
 * Result from failover execution that includes provenance
 */
export interface FailoverExecutionResult<T> {
  data: T;
  providerName: string;
}

/**
 * Result from streaming failover execution with cursor state
 * Used by executeWithFailover to yield batches with provenance and cursor
 */
export interface FailoverStreamingExecutionResult<T> {
  data: T[];
  providerName: string;
  cursor: CursorState;
}

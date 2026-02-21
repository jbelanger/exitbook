import type { CursorState, TokenMetadata } from '@exitbook/core';

import type { RawBalanceData } from './common.js';

export type ProviderOperationParams =
  | {
      address: string;
      contractAddress?: string | undefined; // For token-specific queries
      streamType?: string | undefined; // Chain-specific transaction category (e.g., 'normal', 'internal', 'token', 'beacon_withdrawal')
      type: 'getAddressTransactions';
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressBalances' }
  | { address: string; type: 'hasAddressTransactions' }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressTokenBalances' }
  | { contractAddresses: string[]; type: 'getTokenMetadata' }
  | { address: string; type: 'getAddressInfo' };

export type ProviderOperation = {
  getCacheKey?: (params: ProviderOperationParams) => string;
} & ProviderOperationParams;

// Typed subsets that preserve getCacheKey support
type StreamingOperationParams = Extract<ProviderOperationParams, { type: 'getAddressTransactions' }>;

type OneShotOperationParams = Exclude<ProviderOperationParams, { type: 'getAddressTransactions' }>;

export type StreamingOperation = {
  getCacheKey?: (params: ProviderOperationParams) => string;
} & StreamingOperationParams;
export type OneShotOperation = { getCacheKey?: (params: ProviderOperationParams) => string } & OneShotOperationParams;

export interface AddressInfoData {
  code: string;
  isContract: boolean;
}

export interface OneShotOperationResultByType {
  getAddressBalances: RawBalanceData;
  hasAddressTransactions: boolean;
  getAddressTokenBalances: RawBalanceData[];
  getTokenMetadata: TokenMetadata[];
  getAddressInfo: AddressInfoData;
}

export type OneShotOperationResult<T extends OneShotOperation> = OneShotOperationResultByType[T['type']];

export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalances'
  | 'hasAddressTransactions'
  | 'getAddressTokenBalances'
  | 'getTokenMetadata'
  | 'getAddressInfo'
  | (string & {}); // Allow custom operations while preserving autocomplete

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

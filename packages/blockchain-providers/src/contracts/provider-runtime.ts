import type { CursorState, Result } from '@exitbook/foundation';

import type { TokenMetadataRecord } from '../token-metadata/contracts.js';

import type { RawBalanceData } from './common.js';
import type {
  AddressInfoData,
  FailoverExecutionResult,
  FailoverStreamingExecutionResult,
  ProviderOperationType,
} from './operations.js';
import type { IBlockchainProvider } from './provider.js';

/**
 * Public blockchain provider runtime contract.
 *
 * This is the curated consumer-facing runtime surface intended for published
 * package consumers. The concrete manager class remains an internal
 * implementation detail.
 */
export interface BlockchainProviderSelectionOptions {
  preferredProvider?: string | undefined;
}

export interface BlockchainTokenMetadataQueryOptions extends BlockchainProviderSelectionOptions {
  /**
   * When false, reads persisted token metadata only and returns undefined for cache misses.
   * This also disables stale background refreshes so local rebuild workflows do not depend on
   * provider availability or rate limits.
   */
  allowProviderFetch?: boolean | undefined;
  /** When false, stale cached rows are returned without scheduling a background refresh. */
  refreshStale?: boolean | undefined;
}

export interface BlockchainTransactionStreamOptions extends BlockchainProviderSelectionOptions {
  contractAddress?: string | undefined;
  streamType?: string | undefined;
}

export interface BlockchainBalanceQueryOptions extends BlockchainProviderSelectionOptions {
  contractAddresses?: string[] | undefined;
}

export interface IBlockchainProviderRuntime {
  cleanup(this: void): Promise<Result<void, Error>>;

  streamAddressTransactions<T>(
    blockchain: string,
    address: string,
    options?: BlockchainTransactionStreamOptions,
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>>;

  getAddressBalances(
    blockchain: string,
    address: string,
    options?: BlockchainBalanceQueryOptions
  ): Promise<Result<FailoverExecutionResult<RawBalanceData>, Error>>;

  getAddressTokenBalances(
    blockchain: string,
    address: string,
    options?: BlockchainBalanceQueryOptions
  ): Promise<Result<FailoverExecutionResult<RawBalanceData[]>, Error>>;

  getTokenMetadata(
    blockchain: string,
    contractAddresses: string[],
    options?: BlockchainTokenMetadataQueryOptions
  ): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>>;

  hasAddressTransactions(
    blockchain: string,
    address: string,
    options?: BlockchainProviderSelectionOptions
  ): Promise<Result<FailoverExecutionResult<boolean>, Error>>;

  getAddressInfo(
    blockchain: string,
    address: string,
    options?: BlockchainProviderSelectionOptions
  ): Promise<Result<FailoverExecutionResult<AddressInfoData>, Error>>;

  getProviders(blockchain: string, options?: BlockchainProviderSelectionOptions): IBlockchainProvider[];

  hasRegisteredOperationSupport(blockchain: string, operation: ProviderOperationType): boolean;
}

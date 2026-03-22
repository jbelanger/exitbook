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
 * This is the curated manager surface intended for consumers of the published
 * package. The concrete manager class remains an internal implementation detail.
 */
export interface BlockchainProviderSelectionOptions {
  preferredProvider?: string | undefined;
}

export interface BlockchainTransactionStreamOptions extends BlockchainProviderSelectionOptions {
  contractAddress?: string | undefined;
  streamType?: string | undefined;
}

export interface BlockchainBalanceQueryOptions extends BlockchainProviderSelectionOptions {
  contractAddresses?: string[] | undefined;
}

export interface IBlockchainProviderManager {
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
    options?: BlockchainProviderSelectionOptions
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

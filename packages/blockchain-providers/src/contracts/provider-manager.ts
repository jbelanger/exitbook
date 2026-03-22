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
export interface IBlockchainProviderManager {
  autoRegisterFromConfig(blockchain: string, preferredProvider?: string): IBlockchainProvider[];

  streamAddressTransactions<T>(
    blockchain: string,
    address: string,
    options?: {
      contractAddress?: string;
      streamType?: string;
    },
    resumeCursor?: CursorState
  ): AsyncIterableIterator<Result<FailoverStreamingExecutionResult<T>, Error>>;

  getAddressBalances(
    blockchain: string,
    address: string,
    contractAddresses?: string[]
  ): Promise<Result<FailoverExecutionResult<RawBalanceData>, Error>>;

  getAddressTokenBalances(
    blockchain: string,
    address: string,
    contractAddresses?: string[]
  ): Promise<Result<FailoverExecutionResult<RawBalanceData[]>, Error>>;

  getTokenMetadata(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>>;

  hasAddressTransactions(blockchain: string, address: string): Promise<Result<FailoverExecutionResult<boolean>, Error>>;

  getAddressInfo(blockchain: string, address: string): Promise<Result<FailoverExecutionResult<AddressInfoData>, Error>>;

  getProviders(blockchain: string): IBlockchainProvider[];

  hasRegisteredOperationSupport(blockchain: string, operation: ProviderOperationType): boolean;
}

export type ProviderOperationParams =
  | {
      address: string;
      limit?: number | undefined;
      since?: number | undefined;
      type: 'getAddressTransactions';
      until?: number | undefined;
    }
  | {
      address: string;
      limit?: number | undefined;
      since?: number | undefined;
      type: 'getRawAddressTransactions';
      until?: number | undefined;
    }
  | {
      address: string;
      limit?: number | undefined;
      since?: number | undefined;
      type: 'getRawAddressInternalTransactions';
      until?: number | undefined;
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressBalances' }
  | {
      address: string;
      contractAddress?: string | undefined;
      limit?: number | undefined;
      since?: number | undefined;
      type: 'getTokenTransactions';
      until?: number | undefined;
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getTokenBalances' }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getRawAddressBalance' }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getRawTokenBalances' }
  | { [key: string]: unknown; type: 'custom' };

export type ProviderOperation = {
  getCacheKey?: (params: ProviderOperationParams) => string;
} & ProviderOperationParams;

export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalances'
  | 'getTokenTransactions'
  | 'getTokenBalances'
  | 'getRawAddressTransactions'
  | 'getRawAddressInternalTransactions'
  | 'getRawAddressBalance'
  | 'getRawTokenBalances'
  | 'custom';

/**
 * Result from failover execution that includes provenance
 */
export interface FailoverExecutionResult<T> {
  data: T;
  providerName: string;
}

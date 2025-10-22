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
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressTokenBalances' };

export type ProviderOperation = {
  getCacheKey?: (params: ProviderOperationParams) => string;
} & ProviderOperationParams;

export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalances'
  | 'hasAddressTransactions'
  | 'getAddressTokenTransactions'
  | 'getAddressTokenBalances'
  | 'getAddressInternalTransactions';

/**
 * Result from failover execution that includes provenance
 */
export interface FailoverExecutionResult<T> {
  data: T;
  providerName: string;
}

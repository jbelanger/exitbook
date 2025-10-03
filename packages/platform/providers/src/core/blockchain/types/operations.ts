// Discriminated union type for all possible operation parameters
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
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressBalance' }
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
  | { address: string; type: 'getAddressInfo' }
  | { [key: string]: unknown; type: 'custom' };

// Discriminated union provides automatic type narrowing

export type ProviderOperation<T> = {
  getCacheKey?: (params: ProviderOperationParams) => string;
  transform?: (response: unknown) => T;
} & ProviderOperationParams;

// Provider-specific operation types for capabilities
export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalance'
  | 'getTokenTransactions'
  | 'getTokenBalances'
  | 'getRawAddressTransactions'
  | 'getRawAddressInternalTransactions'
  | 'getRawAddressBalance'
  | 'getRawTokenBalances'
  | 'getAddressInfo'
  | 'custom';

/**
 * Result from failover execution that includes provenance
 */
export interface FailoverExecutionResult<T> {
  data: T;
  providerName: string;
}

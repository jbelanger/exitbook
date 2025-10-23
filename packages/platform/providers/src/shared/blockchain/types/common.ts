/**
 * Common JSON-RPC response interface for blockchain providers
 */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc?: string;
  id?: string | number;
  result: T;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Wrapper for a single transaction that includes both raw provider data and normalized data
 * Used for debugging purposes to retain original provider responses
 */
export interface TransactionWithRawData<TNormalized = unknown> {
  raw: unknown;
  normalized: TNormalized;
}

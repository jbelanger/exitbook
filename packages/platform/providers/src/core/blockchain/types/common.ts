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

import type { DataSourceCapabilities, RateLimitConfig } from "@crypto/core";

// Parameter interfaces for each operation type
export interface AddressTransactionParams {
  address: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface AddressBalanceParams {
  address: string;
  contractAddresses?: string[];
}

export interface TokenTransactionParams {
  address: string;
  contractAddress?: string;
  since?: number;
  until?: number;
  limit?: number;
}

export interface TokenBalanceParams {
  address: string;
  contractAddresses?: string[];
}

export interface AddressInfoParams {
  address: string;
}

export interface ParseWalletTransactionParams {
  tx: unknown;
  walletAddresses: string[];
}

// Discriminated union type for all possible operation parameters
export type ProviderOperationParams =
  | { type: 'getAddressTransactions'; address: string; since?: number | undefined; until?: number | undefined; limit?: number | undefined }
  | { type: 'getRawAddressTransactions'; address: string; since?: number | undefined; until?: number | undefined; limit?: number | undefined }
  | { type: 'getAddressBalance'; address: string; contractAddresses?: string[] | undefined }
  | { type: 'getTokenTransactions'; address: string; contractAddress?: string | undefined; since?: number | undefined; until?: number | undefined; limit?: number | undefined }
  | { type: 'getTokenBalances'; address: string; contractAddresses?: string[] | undefined }
  | { type: 'getAddressInfo'; address: string }
  | { type: 'parseWalletTransaction'; tx: unknown; walletAddresses: string[] }
  | { type: 'testConnection' }
  | { type: 'custom'; [key: string]: unknown };

// Type guard functions for type narrowing (now simplified with discriminated union)
export function hasAddressParam(
  operation: ProviderOperation<unknown>,
): operation is ProviderOperation<unknown> & { address: string } {
  return (
    operation.type !== "parseWalletTransaction" &&
    operation.type !== "testConnection" &&
    operation.type !== "custom"
  );
}

export function isAddressTransactionOperation(
  operation: ProviderOperation<unknown>,
): operation is ProviderOperation<unknown> & {
  type: 'getAddressTransactions' | 'getRawAddressTransactions';
  address: string;
  since?: number;
  until?: number;
  limit?: number;
} {
  return (
    operation.type === "getAddressTransactions" ||
    operation.type === "getRawAddressTransactions"
  );
}

export function isAddressBalanceOperation(
  operation: ProviderOperation<unknown>,
): operation is ProviderOperation<unknown> & {
  type: 'getAddressBalance';
  address: string;
  contractAddresses?: string[];
} {
  return operation.type === "getAddressBalance";
}

export function isTokenTransactionOperation(
  operation: ProviderOperation<unknown>,
): operation is ProviderOperation<unknown> & {
  type: 'getTokenTransactions';
  address: string;
  contractAddress?: string;
  since?: number;
  until?: number;
  limit?: number;
} {
  return operation.type === "getTokenTransactions";
}

export function isTokenBalanceOperation(
  operation: ProviderOperation<unknown>,
): operation is ProviderOperation<unknown> & {
  type: 'getTokenBalances';
  address: string;
  contractAddresses?: string[];
} {
  return operation.type === "getTokenBalances";
}

export function isAddressInfoOperation(
  operation: ProviderOperation<unknown>,
): operation is ProviderOperation<unknown> & {
  type: 'getAddressInfo';
  address: string;
} {
  return operation.type === "getAddressInfo";
}

export function isParseWalletTransactionOperation(
  operation: ProviderOperation<unknown>,
): operation is ProviderOperation<unknown> & {
  type: 'parseWalletTransaction';
  tx: unknown;
  walletAddresses: string[];
} {
  return operation.type === "parseWalletTransaction";
}

// Common JSON-RPC response interface for blockchain providers
export interface JsonRpcResponse<T = unknown> {
  result: T;
  error?: { code: number; message: string };
  id?: number | string;
  jsonrpc?: string;
}

export interface IBlockchainProvider<TConfig = Record<string, unknown>> {
  readonly name: string;
  readonly blockchain: string;
  readonly capabilities: ProviderCapabilities;
  readonly rateLimit: RateLimitConfig;

  // Health and connectivity
  isHealthy(): Promise<boolean>;
  testConnection(): Promise<boolean>;

  // Universal execution method - all operations go through this
  execute<T>(operation: ProviderOperation<T>, config: TConfig): Promise<T>;
}

export type ProviderOperation<T> = {
  transform?: (response: unknown) => T;
  getCacheKey?: (params: ProviderOperationParams) => string;
} & ProviderOperationParams;

// Provider-specific operation types for capabilities
export type ProviderOperationType =
  | "getAddressTransactions"
  | "getAddressBalance"
  | "getTokenTransactions"
  | "getTokenBalances"
  | "getRawAddressTransactions"
  | "getAddressInfo"
  | "parseWalletTransaction";

export interface ProviderCapabilities
  extends DataSourceCapabilities<ProviderOperationType> {
  /** Whether the provider supports real-time data access */
  supportsRealTimeData: boolean;

  /** Whether the provider supports token-specific operations */
  supportsTokenData: boolean;
}

export interface ProviderHealth {
  isHealthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
  averageResponseTime: number;
  errorRate: number;
  lastError?: string | undefined;
  rateLimitEvents: number; // Total rate limit events encountered
  rateLimitRate: number; // Percentage of requests that were rate limited (0-1)
  lastRateLimitTime?: number | undefined; // Timestamp of last rate limit event
}

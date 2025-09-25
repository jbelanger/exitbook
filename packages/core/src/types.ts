import type { Decimal } from 'decimal.js';

// Money type for consistent amount and currency structure with high precision
export interface Money {
  amount: Decimal;
  currency: string;
}

export type TransactionType = 'trade' | 'deposit' | 'withdrawal' | 'order' | 'ledger' | 'transfer' | 'fee';

export type TransactionStatus = 'pending' | 'open' | 'closed' | 'canceled' | 'failed' | 'ok';

// Transaction note interface
export interface TransactionNote {
  message: string;
  metadata?: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'error';
  type: TransactionNoteType;
}

// Lightweight alias for transaction note types coming from other packages.
// Kept as a string for minimal coupling; can be replaced with a concrete union
// or imported type from the import package if that package becomes a dependency.
export type TransactionNoteType = string;

// CLI types
export interface CLIOptions {
  config?: string;
  exchange?: string;
  since?: string;
  verbose?: boolean;
  verify?: boolean;
}

// ===== BLOCKCHAIN-SPECIFIC TYPES =====
export interface BlockchainInfo {
  capabilities: BlockchainCapabilities;
  id: string;
  name: string;
  network: string;
}

export interface BlockchainCapabilities {
  supportsAddressTransactions: boolean;
  supportsBalanceQueries: boolean;
  supportsHistoricalData: boolean;
  supportsPagination: boolean;
  supportsTokenTransactions: boolean;
}

export interface TokenConfig {
  contractAddress?: string;
  decimals: number;
  name?: string;
  symbol: string;
}

export interface BlockchainBalance {
  balance: number; // Available/free amount
  contractAddress?: string | undefined;
  currency: string;
  total: number; // Total balance (balance + used)
  used: number; // Used/frozen amount
}

/**
 * High-precision blockchain balance using Decimal for accurate financial calculations
 * Recommended for new code to avoid precision loss in cryptocurrency amounts
 */
export interface PrecisionBlockchainBalance {
  balance: Decimal; // Available/free amount with full precision
  contractAddress?: string | undefined;
  currency: string;
  total: Decimal; // Total balance (balance + used) with full precision
  used: Decimal; // Used/frozen amount with full precision
}

// Legacy alias for compatibility
export type Balance = BlockchainBalance;

// ===== API AND UTILITY TYPES =====
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  pagination?: {
    hasMore: boolean;
    page: number;
    pageSize: number;
    total: number;
  };
  success: boolean;
}

export interface CacheConfig {
  enabled: boolean;
  maxSize: number; // Maximum number of cached items
  ttl: number; // Time to live in seconds
}

// Generic error classes for both exchange and blockchain operations
export class ServiceError extends Error {
  constructor(
    message: string,
    public service: string, // exchange name or blockchain name
    public operation: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface RateLimitConfig {
  burstLimit?: number;
  requestsPerHour?: number;
  requestsPerMinute?: number;
  requestsPerSecond: number;
}

export class RateLimitError extends ServiceError {
  constructor(
    message: string,
    service: string,
    operation: string,
    public retryAfter?: number
  ) {
    super(message, service, operation);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends ServiceError {
  constructor(message: string, service: string, operation: string) {
    super(message, service, operation);
    this.name = 'AuthenticationError';
  }
}

// ===== UNIFIED DATA SOURCE CAPABILITIES =====

/**
 * Generic data source capabilities interface that provides a unified model
 * for describing the capabilities of any data source (exchanges, blockchain providers, etc.).
 *
 * @template TOperations - The specific operation types supported by this data source
 *
 * @example
 * // For blockchain providers
 * type BlockchainOperations = 'getAddressTransactions' | 'getAddressBalance' | 'getTokenTransactions';
 * interface ProviderCapabilities extends DataSourceCapabilities<BlockchainOperations> {
 *   supportsTokenData: boolean;
 * }
 *
 * // For exchange adapters
 * type ExchangeOperations = 'fetchTrades' | 'fetchDeposits' | 'fetchWithdrawals';
 * interface ExchangeCapabilities extends DataSourceCapabilities<ExchangeOperations> {
 *   requiresApiKey: boolean;
 * }
 */
export interface DataSourceCapabilities<TOperations extends string = string> {
  /**
   * Extension point for data source specific capabilities.
   * Allows each data source type to add custom capability flags without
   * polluting the base interface.
   */
  extensions?: Record<string, unknown>;

  /** Maximum number of items that can be requested in a single batch operation */
  maxBatchSize?: number;

  /** Array of operation types that this data source supports */
  supportedOperations: TOperations[];

  /** Whether the data source provides access to historical data */
  supportsHistoricalData: boolean;

  /** Whether the data source supports paginated requests for large datasets */
  supportsPagination: boolean;
}

// Universal Adapter System - Single unified interface for all data sources

/**
 * Universal adapter interface that provides a consistent interface for all data sources
 * (exchanges, blockchains, etc.). This replaces the separate IExchangeAdapter and
 * IBlockchainAdapter interfaces with a single unified interface.
 */
export interface IUniversalAdapter {
  close(): Promise<void>;
  fetchBalances(params: UniversalFetchParameters): Promise<UniversalBalance[]>;
  fetchTransactions(params: UniversalFetchParameters): Promise<UniversalTransaction[]>;
  getInfo(): Promise<UniversalAdapterInfo>;
  testConnection(): Promise<boolean>;
}

export interface UniversalAdapterInfo {
  capabilities: UniversalAdapterCapabilities;
  id: string;
  name: string;
  subType?: 'ccxt' | 'csv' | 'native' | 'rpc' | 'rest';
  type: 'exchange' | 'blockchain';
}

export interface UniversalAdapterCapabilities {
  maxBatchSize: number;
  rateLimit?: {
    burstLimit: number;
    requestsPerSecond: number;
  };
  requiresApiKey: boolean;
  supportedOperations: (
    | 'fetchTransactions'
    | 'fetchBalances'
    | 'getAddressTransactions'
    | 'getAddressBalance'
    | 'getTokenTransactions'
  )[];
  supportsHistoricalData: boolean;
  supportsPagination: boolean;
}

export interface UniversalFetchParameters {
  // Universal params
  // Optional type-specific params
  includeTokens?: boolean | undefined; // For blockchains
  // Pagination
  limit?: number | undefined;
  offset?: number | undefined;

  since?: number | undefined; // Time filter
  symbols?: string[] | undefined; // Filter by asset symbols

  transactionTypes?: TransactionType[] | undefined;
  until?: number | undefined; // Time filter
}

export interface UniversalTransaction {
  // Amounts
  amount: Money;
  datetime: string;
  fee?: Money | undefined;
  // Parties (works for both)
  from?: string | undefined; // Sender address OR exchange account
  // Universal fields
  id: string;

  metadata: Record<string, unknown>;
  network?: string | undefined; // e.g., 'mainnet'
  note?: TransactionNote | undefined; // Scam detection, warnings, classification
  price?: Money | undefined;

  // Metadata
  source: string; // e.g., 'coinbase', 'bitcoin'
  status: TransactionStatus;
  symbol?: string | undefined; // Add symbol for trades

  timestamp: number;
  to?: string | undefined; // Receiver address OR exchange account
  type: TransactionType;
}

export interface UniversalBalance {
  contractAddress?: string | undefined;
  currency: string;
  free: number;
  total: number;
  used: number;
}

/**
 * High-precision universal balance using Decimal for accurate financial calculations
 * Recommended for new code to avoid precision loss in cryptocurrency amounts
 */
export interface PrecisionUniversalBalance {
  contractAddress?: string | undefined;
  currency: string;
  free: Decimal;
  total: Decimal;
  used: Decimal;
}

// Universal adapter configuration
interface BaseUniversalAdapterConfig {
  id: string;
  type: 'exchange' | 'blockchain';
}

export interface UniversalExchangeAdapterConfig extends BaseUniversalAdapterConfig {
  credentials?:
    | {
        apiKey: string;
        password?: string | undefined;
        secret: string;
      }
    | undefined;
  csvDirectories?: string[] | undefined;
  subType: 'ccxt' | 'csv' | 'native';
  type: 'exchange';
}

export interface UniversalBlockchainAdapterConfig extends BaseUniversalAdapterConfig {
  network: string;
  subType: 'rest' | 'rpc';
  type: 'blockchain';
}

export type UniversalAdapterConfig = UniversalExchangeAdapterConfig | UniversalBlockchainAdapterConfig;

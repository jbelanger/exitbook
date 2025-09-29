import type { Decimal } from 'decimal.js';

// Money type for consistent amount and currency structure with high precision
export interface Money {
  amount: Decimal;
  currency: string;
}

export type TransactionType =
  | 'trade'
  | 'deposit'
  | 'withdrawal'
  | 'order'
  | 'ledger'
  | 'transfer'
  | 'fee'
  | 'staking_deposit' // Staking funds (bonding)
  | 'staking_withdrawal' // Unstaking funds (unbonding/withdraw)
  | 'staking_reward' // Staking rewards received
  | 'governance_deposit' // Governance deposits (proposals, votes)
  | 'governance_refund' // Governance refunds
  | 'internal_transfer' // Self-to-self transfers
  | 'proxy' // Proxy transactions
  | 'multisig' // Multisig transactions
  | 'utility_batch' // Batch transactions
  | 'unknown';

export type TransactionStatus = 'pending' | 'open' | 'closed' | 'canceled' | 'failed' | 'ok';

// Transaction note interface
export interface TransactionNote {
  message: string;
  metadata?: Record<string, unknown> | undefined;
  severity?: 'info' | 'warning' | 'error' | undefined;
  type: TransactionNoteType;
}

// Lightweight alias for transaction note types coming from other packages.
// Kept as a string for minimal coupling; can be replaced with a concrete union
// or imported type from the import package if that package becomes a dependency.
export type TransactionNoteType = string;

// CLI types
export interface CLIOptions {
  config?: string | undefined;
  exchange?: string | undefined;
  since?: string | undefined;
  verbose?: boolean | undefined;
  verify?: boolean | undefined;
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
  contractAddress?: string | undefined;
  decimals: number;
  name?: string | undefined;
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
  data?: T | undefined;
  error?: string | undefined;
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
  extensions?: Record<string, unknown> | undefined;

  /** Maximum number of items that can be requested in a single batch operation */
  maxBatchSize?: number | undefined;

  /** Array of operation types that this data source supports */
  supportedOperations: TOperations[];

  /** Whether the data source provides access to historical data */
  supportsHistoricalData: boolean;

  /** Whether the data source supports paginated requests for large datasets */
  supportsPagination: boolean;
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

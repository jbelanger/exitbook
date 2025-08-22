import { Decimal } from 'decimal.js';

// Money type for consistent amount and currency structure with high precision
export interface Money {
  amount: Decimal;
  currency: string;
}

/**
 * Universal transaction format that serves as the common abstraction layer across all transaction sources.
 * This interface provides a standardized representation for transactions from exchanges (CCXT, native, CSV)
 * and blockchain adapters, enabling unified processing throughout the application.
 * 
 * Flow: BlockchainTransaction/ExchangeTransaction → CryptoTransaction → EnhancedTransaction
 * 
 * @example
 * // From exchange adapter
 * const cryptoTx = exchangeAdapter.fetchTrades()[0]; // Returns CryptoTransaction
 * 
 * // From blockchain adapter  
 * const blockchainTx = blockchainAdapter.getAddressTransactions()[0]; // Returns BlockchainTransaction
 * const cryptoTx = blockchainAdapter.convertToCryptoTransaction(blockchainTx, userAddress); // Returns CryptoTransaction
 */
export interface CryptoTransaction {
  id: string;
  type: TransactionType;
  timestamp: number;
  datetime?: string;
  symbol?: string;
  amount: Money;
  side?: 'buy' | 'sell';
  price?: Money;
  fee?: Money;
  status?: TransactionStatus;
  info?: any; // Raw response data from source (exchange API response or blockchain transaction data)
}

export type TransactionType =
  | 'trade'
  | 'deposit'
  | 'withdrawal'
  | 'order'
  | 'ledger'
  | 'transfer'
  | 'fee';

export type TransactionStatus =
  | 'pending'
  | 'open'
  | 'closed'
  | 'canceled'
  | 'failed'
  | 'ok';
  


/**
 * Enhanced transaction with processing metadata for internal application use.
 * This interface extends CryptoTransaction with tracking, deduplication, and annotation metadata
 * required for the import pipeline, storage, and verification processes.
 * 
 * Created by: TransactionImporter.enhanceTransaction()
 * Used by: Deduplicator, Database, BalanceVerifier
 * 
 * @example
 * const enhanced = importer.enhanceTransaction(cryptoTx, 'kucoin'); // Adds hash, source, etc.
 * const { unique, duplicates } = await deduplicator.process(enhancedTxs, 'kucoin');
 * await database.saveTransactions(unique);
 */
export interface EnhancedTransaction extends CryptoTransaction {
  /** Exchange ID or blockchain identifier (e.g., 'kucoin', 'ethereum', 'bitcoin') */
  source: string;
  /** Unique hash for deduplication, generated from transaction properties and source */
  hash: string;
  /** Timestamp when transaction was imported into the system */
  importedAt: number;
  /** Whether transaction has been verified against live exchange/blockchain data */
  verified?: boolean;
  /** Original raw data from source for debugging and compatibility */
  originalData?: any;
  /** Optional annotation for scam detection, warnings, or classification */
  note?: TransactionNote;
}

// Transaction note interface  
export interface TransactionNote {
  type: any; // TransactionNoteType from import package
  message: string;
  severity?: 'info' | 'warning' | 'error';
  metadata?: Record<string, any>;
}

// CLI types
export interface CLIOptions {
  verify?: boolean;
  exchange?: string;
  since?: string;
  verbose?: boolean;
  config?: string;
}

// Wallet address tracking types moved to @crypto/data package

// Legacy IBlockchainAdapter interface removed - now using IUniversalAdapter

// ===== BLOCKCHAIN-SPECIFIC TYPES =====
export interface BlockchainInfo {
  id: string;
  name: string;
  network: string;
  capabilities: BlockchainCapabilities;
}

export interface BlockchainCapabilities {
  supportsAddressTransactions: boolean;
  supportsTokenTransactions: boolean;
  supportsBalanceQueries: boolean;
  supportsHistoricalData: boolean;
  supportsPagination: boolean;
  maxLookbackDays?: number;
}

export interface TokenConfig {
  symbol: string;
  contractAddress?: string;
  decimals: number;
  name?: string;
}

export interface BlockchainBalance {
  currency: string;
  balance: number; // Available/free amount
  used: number;    // Used/frozen amount  
  total: number;   // Total balance (balance + used)
  contractAddress?: string;
}

// Legacy alias for compatibility
export type Balance = BlockchainBalance;

/**
 * Raw blockchain transaction format containing blockchain-specific metadata.
 * This interface represents transactions in their native blockchain format with full context
 * including block information, gas details, and blockchain-specific transaction types.
 * 
 * Source: Blockchain providers (Etherscan, Mempool.space, Injective Explorer, etc.)
 * Converted to: CryptoTransaction via IBlockchainAdapter.convertToCryptoTransaction()
 * 
 * @example
 * // From Ethereum provider
 * const ethTxs = await etherscanProvider.getTransactions(address); // Returns BlockchainTransaction[]
 * const cryptoTxs = ethTxs.map(tx => adapter.convertToCryptoTransaction(tx, address));
 */
export interface BlockchainTransaction {
  /** Transaction hash - unique identifier on the blockchain */
  hash: string;
  /** Block number where transaction was included */
  blockNumber: number;
  /** Hash of the block containing this transaction */
  blockHash: string;
  /** Unix timestamp when transaction was mined/confirmed */
  timestamp: number;
  /** Sender address (blockchain-native format) */
  from: string;
  /** Recipient address (blockchain-native format) */
  to: string;
  /** Transaction value/amount with currency information */
  value: Money;
  /** Transaction fee paid */
  fee: Money;
  /** Gas units consumed (Ethereum/EVM chains) */
  gasUsed?: number;
  /** Gas price per unit (Ethereum/EVM chains) */
  gasPrice?: number;
  /** Blockchain-native transaction status */
  status: 'success' | 'failed' | 'pending';
  /** Detailed blockchain-specific transaction type for accurate classification */
  type: 'transfer' | 'contract_execution' | 'token_transfer' | 'transfer_in' | 'transfer_out' | 'internal_transfer_in' | 'internal_transfer_out' | 'token_transfer_in' | 'token_transfer_out';
  /** Token contract address (for token transactions) */
  tokenContract?: string;
  /** Token symbol (for token transactions) */
  tokenSymbol?: string;
  /** Transaction nonce (ordering/replay protection) */
  nonce?: number;
  /** Number of block confirmations */
  confirmations?: number;
}

// ===== API AND UTILITY TYPES =====
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface CacheConfig {
  ttl: number; // Time to live in seconds
  maxSize: number; // Maximum number of cached items
  enabled: boolean;
}

// Generic error classes for both exchange and blockchain operations
export class ServiceError extends Error {
  constructor(
    message: string,
    public service: string,  // exchange name or blockchain name
    public operation: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface RateLimitConfig {
  requestsPerSecond: number;
  requestsPerMinute?: number;
  requestsPerHour?: number;
  burstLimit?: number;
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
  /** Array of operation types that this data source supports */
  supportedOperations: TOperations[];
  
  /** Whether the data source supports paginated requests for large datasets */
  supportsPagination: boolean;
  
  /** Whether the data source provides access to historical data */
  supportsHistoricalData: boolean;
  
  /** Maximum number of items that can be requested in a single batch operation */
  maxBatchSize?: number;
  
  /** Maximum number of days of historical data available (null = unlimited) */
  maxLookbackDays?: number;
  
  /** 
   * Extension point for data source specific capabilities.
   * Allows each data source type to add custom capability flags without
   * polluting the base interface.
   */
  extensions?: Record<string, any>;
}

// Universal Adapter System - Single unified interface for all data sources

/**
 * Universal adapter interface that provides a consistent interface for all data sources
 * (exchanges, blockchains, etc.). This replaces the separate IExchangeAdapter and 
 * IBlockchainAdapter interfaces with a single unified interface.
 */
export interface IUniversalAdapter {
  getInfo(): Promise<UniversalAdapterInfo>;
  testConnection(): Promise<boolean>;
  close(): Promise<void>;
  fetchTransactions(params: UniversalFetchParams): Promise<UniversalTransaction[]>;
  fetchBalances(params: UniversalFetchParams): Promise<UniversalBalance[]>;
}

export interface UniversalAdapterInfo {
  id: string;
  name: string;
  type: 'exchange' | 'blockchain';
  subType?: 'ccxt' | 'csv' | 'rpc' | 'rest';
  capabilities: UniversalAdapterCapabilities;
}

export interface UniversalAdapterCapabilities {
  supportedOperations: Array<
    | 'fetchTransactions' 
    | 'fetchBalances' 
    | 'getAddressTransactions'
    | 'getAddressBalance'
    | 'getTokenTransactions'
  >;
  maxBatchSize: number;
  supportsHistoricalData: boolean;
  supportsPagination: boolean;
  requiresApiKey: boolean;
  rateLimit?: {
    requestsPerSecond: number;
    burstLimit: number;
  };
}

export interface UniversalFetchParams {
  // Universal params
  addresses?: string[];        // For blockchains OR exchange accounts
  symbols?: string[];          // Filter by asset symbols
  since?: number;              // Time filter
  until?: number;              // Time filter
  
  // Optional type-specific params
  includeTokens?: boolean;     // For blockchains
  transactionTypes?: TransactionType[];
  
  // Pagination
  limit?: number;
  offset?: number;
}

export interface UniversalTransaction {
  // Universal fields
  id: string;
  timestamp: number;
  datetime: string;
  type: TransactionType;
  status: TransactionStatus;
  
  // Amounts
  amount: Money;
  fee?: Money;
  price?: Money;
  side?: 'buy' | 'sell'; // Trade side for balance calculations
  
  // Parties (works for both)
  from?: string;  // Sender address OR exchange account
  to?: string;    // Receiver address OR exchange account
  symbol?: string; // Add symbol for trades
  
  // Metadata
  source: string; // e.g., 'coinbase', 'bitcoin'
  network?: string; // e.g., 'mainnet'
  metadata: Record<string, any>;
}

export interface UniversalBalance {
  currency: string;
  total: number;
  free: number;
  used: number;
  contractAddress?: string;
}

// Universal adapter configuration
interface BaseUniversalAdapterConfig {
  type: 'exchange' | 'blockchain';
  id: string;
}

export interface UniversalExchangeAdapterConfig extends BaseUniversalAdapterConfig {
  type: 'exchange';
  subType: 'ccxt' | 'csv' | 'native';
  credentials?: { 
    apiKey: string; 
    secret: string; 
    password?: string; 
  };
  csvDirectories?: string[];
}

export interface UniversalBlockchainAdapterConfig extends BaseUniversalAdapterConfig {
  type: 'blockchain';
  subType: 'rest' | 'rpc';
  network: string;
}

export type UniversalAdapterConfig = UniversalExchangeAdapterConfig | UniversalBlockchainAdapterConfig;
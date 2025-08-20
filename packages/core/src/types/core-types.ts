import { Decimal } from 'decimal.js';

// Money type for consistent amount and currency structure with high precision
export interface Money {
  amount: Decimal;
  currency: string;
}

// Exchange-agnostic types and interfaces (new architecture)

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
  
export interface ExchangeBalance {
  currency: string;
  balance: number; // Available/free amount
  used: number;
  total: number;
}

export interface ExchangeInfo {
  id: string;
  name: string;
  version?: string;
  capabilities: ExchangeCapabilities;
  rateLimit?: number;
}

export interface ExchangeCapabilities {
  fetchMyTrades: boolean;
  fetchDeposits: boolean;
  fetchWithdrawals: boolean;
  fetchLedger: boolean;
  fetchClosedOrders: boolean;
  fetchBalance: boolean;
  fetchOrderBook: boolean;
  fetchTicker: boolean;
}

// Abstract interface for exchange operations
export interface IExchangeAdapter {
  // Connection and info
  testConnection(): Promise<boolean>;
  getExchangeInfo(): Promise<ExchangeInfo>;

  // Transaction fetching
  fetchAllTransactions(since?: number): Promise<CryptoTransaction[]>;
  fetchTrades(since?: number): Promise<CryptoTransaction[]>;
  fetchDeposits(since?: number): Promise<CryptoTransaction[]>;
  fetchWithdrawals(since?: number): Promise<CryptoTransaction[]>;
  fetchClosedOrders(since?: number): Promise<CryptoTransaction[]>;
  fetchLedger(since?: number): Promise<CryptoTransaction[]>;

  // Balance operations
  fetchBalance(): Promise<ExchangeBalance[]>;

  // Cleanup
  close(): Promise<void>;
}


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


// Balance verification types moved to @crypto/balance package

// Database types moved to @crypto/data package


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

// ===== BLOCKCHAIN ADAPTER INTERFACE =====
// Specialized interface for blockchain adapters
export interface IBlockchainAdapter {
  // Core required methods
  testConnection(): Promise<boolean>;
  getBlockchainInfo(): Promise<BlockchainInfo>;
  getAddressTransactions(address: string, since?: number): Promise<BlockchainTransaction[]>;
  getAddressBalance(address: string): Promise<BlockchainBalance[]>;
  validateAddress(address: string): boolean;
  /**
   * Converts a raw blockchain transaction to the standardized CryptoTransaction format.
   * This method transforms blockchain-specific data into the universal transaction format,
   * determining transaction direction (deposit/withdrawal) based on the user's address.
   * 
   * @param blockchainTx - Raw blockchain transaction with full blockchain context
   * @param userAddress - User's wallet address to determine transaction direction
   * @returns Standardized CryptoTransaction for further processing
   * 
   * @example
   * const ethTx = await provider.getTransaction(hash); // BlockchainTransaction
   * const cryptoTx = adapter.convertToCryptoTransaction(ethTx, '0x123...'); // CryptoTransaction
   * // cryptoTx.type will be 'deposit' if ethTx.to === userAddress, 'withdrawal' if ethTx.from === userAddress
   */
  convertToCryptoTransaction(blockchainTx: BlockchainTransaction, userAddress: string): CryptoTransaction;
  close(): Promise<void>;

  // Optional token methods (only implement if blockchain supports tokens)
  getTokenTransactions?(address: string, tokenContract?: string): Promise<BlockchainTransaction[]>;
  getTokenBalances?(address: string): Promise<BlockchainBalance[]>;
}

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
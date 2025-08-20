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

export interface ExchangeBalance {
  currency: string;
  balance: number; // Available/free amount
  used: number;
  total: number;
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

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  password?: string; // Used by some exchanges for passphrase
  sandbox?: boolean;
  [key: string]: any; // Allow for exchange-specific credentials
}

export interface ExchangeOptions {
  rateLimit?: number;
  enableRateLimit?: boolean;
  timeout?: number;
  csvDirectory?: string; // For CSV adapter
  uid?: string; // For CSV adapter - optional UID to filter by
  [key: string]: any;
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

// Exchange configuration for traditional exchange adapters
export interface ExchangeConfig {
  id: string;
  enabled: boolean;
  adapterType?: 'ccxt' | 'native' | 'csv';
  credentials: ExchangeCredentials;
  options?: ExchangeOptions;
}

// Balance verification types
export interface BalanceComparison {
  currency: string;
  liveBalance: number;
  calculatedBalance: number;
  difference: number;
  status: 'match' | 'mismatch' | 'warning';
  percentageDiff: number;
  tolerance: number;
}

export interface BalanceVerificationResult {
  exchange: string;
  timestamp: number;
  status: 'success' | 'error' | 'warning';
  comparisons: BalanceComparison[];
  error?: string;
  note?: string;
  summary: {
    totalCurrencies: number;
    matches: number;
    mismatches: number;
    warnings: number;
  };
}

// Database types
export interface StoredTransaction {
  id: string;
  exchange: string;
  type: string;
  timestamp: number;
  datetime?: string;
  symbol?: string;
  amount: number;
  amount_currency?: string;
  side?: string;
  price?: number;
  price_currency?: string;
  cost?: number;
  cost_currency?: string;
  fee_cost?: number;
  fee_currency?: string;
  status?: string;
  from_address?: string;
  to_address?: string;
  wallet_id?: number;
  raw_data: string; // JSON stringified transaction data
  created_at: number;
  hash: string;
  verified?: boolean;
  note_type?: string;
  note_message?: string;
  note_severity?: 'info' | 'warning' | 'error';
  note_metadata?: string; // JSON stringified metadata
}

export interface BalanceSnapshot {
  id?: number;
  exchange: string;
  currency: string;
  balance: number;
  timestamp: number;
  created_at: number;
}

export interface BalanceVerificationRecord {
  id?: number;
  exchange: string;
  currency: string;
  expected_balance: number;
  actual_balance: number;
  difference: number;
  status: string;
  timestamp: number;
  created_at?: number; // Made optional for compatibility
}

// Import results (shared by exchange and blockchain adapters)
export interface ImportResult {
  source: string; // Exchange or blockchain identifier
  transactions: number;
  newTransactions: number;
  duplicatesSkipped: number;
  errors: string[];
  duration: number;
}

export interface ImportSummary {
  totalTransactions: number;
  newTransactions: number;
  duplicatesSkipped: number;
  sourceResults: ImportResult[]; // Results from all sources (exchanges + blockchains)
  errors: string[];
  duration: number;
}

// Logger types
export interface LogContext {
  component?: string;
  exchange?: string;
  currency?: string;
  transactionId?: string;
  operation?: string;
  [key: string]: any;
}

// Transaction Note Types - Enum for standardized transaction annotations
export enum TransactionNoteType {
  // Security & Scam Detection
  SCAM_TOKEN = 'SCAM_TOKEN',
  SUSPICIOUS_AIRDROP = 'SUSPICIOUS_AIRDROP',

  // Transaction Quality
  DUST_TRANSACTION = 'DUST_TRANSACTION',
  FAILED_TRANSACTION = 'FAILED_TRANSACTION',
  HIGH_FEE = 'HIGH_FEE',

  // Transfer Types
  INTERNAL_TRANSFER = 'INTERNAL_TRANSFER',
  STAKING_REWARD = 'STAKING_REWARD',
  UNSTAKING = 'UNSTAKING',

  // Exchange Operations
  PARTIAL_FILL = 'PARTIAL_FILL',
  MARGIN_LIQUIDATION = 'MARGIN_LIQUIDATION',

  // Airdrops & Rewards
  LEGITIMATE_AIRDROP = 'LEGITIMATE_AIRDROP',
  MINING_REWARD = 'MINING_REWARD',
  VALIDATOR_REWARD = 'VALIDATOR_REWARD',

  // Special Cases
  DUST_SWEEP = 'DUST_SWEEP',
  NETWORK_FEE_ONLY = 'NETWORK_FEE_ONLY',
  TEST_TRANSACTION = 'TEST_TRANSACTION'
}

// Transaction note interface
export interface TransactionNote {
  type: TransactionNoteType;
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

// Configuration types
export interface AppConfig {
  exchanges: Record<string, ExchangeConfig>;
  database: {
    path: string;
  };
  logging: {
    level: string;
    directory: string;
  };
  verification: {
    tolerance: number;
    warnThreshold: number;
    errorThreshold: number;
  };
}

// Wallet address tracking types
export interface WalletAddress {
  id: number;
  address: string;
  blockchain: string;
  label?: string;
  addressType: 'personal' | 'exchange' | 'contract' | 'unknown';
  isActive: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWalletAddressRequest {
  address: string;
  blockchain: string;
  label?: string;
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  notes?: string;
}

export interface UpdateWalletAddressRequest {
  label?: string;
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  isActive?: boolean;
  notes?: string;
}

export interface WalletAddressQuery {
  blockchain?: string;
  addressType?: 'personal' | 'exchange' | 'contract' | 'unknown';
  isActive?: boolean;
  search?: string; // Search in address, label, or notes
}

// Enhanced transaction type with wallet address references
export interface TransactionWithAddresses extends EnhancedTransaction {
  fromAddress?: string;
  toAddress?: string;
  fromWalletId?: number;
  toWalletId?: number;
  isInternalTransfer?: boolean;
  fromWallet?: WalletAddress;
  toWallet?: WalletAddress;
}

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
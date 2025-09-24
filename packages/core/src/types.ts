import { Decimal } from 'decimal.js';

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
  supportedOperations: Array<
    'fetchTransactions' | 'fetchBalances' | 'getAddressTransactions' | 'getAddressBalance' | 'getTokenTransactions'
  >;
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

// ===== PROCESSED TRANSACTION TYPES =====

/**
 * DecimalString represents a Decimal.js value as a string for serialization
 * Use Decimal.js for calculations, serialize to string for storage/transport
 */
export type DecimalString = string;

/**
 * ProcessedTransaction: Factual money movements with source metadata and event context,
 * without accounting interpretations. Replaces UniversalTransaction with movement-based model.
 */
export interface ProcessedTransaction {
  blockNumber?: number; // For blockchain transactions
  eventType: TransactionEventType; // TRADE, TRANSFER, REWARD, etc.
  // Identity and Source Tracking
  id: string; // Unique per (source, sourceUid, id) tuple
  // Financial Movements
  movements: Movement[]; // Array of individual asset flows

  // Audit and Linking
  originalData?: Record<string, unknown>; // Raw source data for auditing
  // Processing Metadata
  processedAt: Date; // When this was created by processor
  processorVersion: string; // Version of processor used

  relatedTransactionIds?: string[]; // Links to related transactions

  source: TransactionSource; // Exchange, blockchain network, etc.
  sourceSpecific: SourceDetails; // Tagged union for source-specific metadata
  sourceUid: string; // User/account identifier within source

  // Timing and Context
  timestamp: Date; // Transaction occurrence time
  validationStatus: ValidationStatus;
}

/**
 * Individual asset flow with currency, quantity, direction, and optional classification hints
 */
export interface Movement {
  amount: DecimalString; // Precise amount using Decimal.js serialization
  // Asset and Quantity
  currency: string; // Asset symbol (BTC, ETH, USD, etc.)
  direction: MovementDirection; // IN or OUT relative to user's account

  linkedMovementIds?: string[]; // Links to related movements (fee→principal)
  metadata: MovementMetadata; // Additional context for classification

  // Classification Hints (for classifier)
  movementHint?: MovementHint; // Processor's suggestion for purpose
  // Linking and Audit
  movementId: string; // Unique within transaction
}

/**
 * Movement direction relative to user's targeted account/scope
 */
export enum MovementDirection {
  IN = 'IN', // Asset flowing into user's account
  OUT = 'OUT', // Asset flowing out of user's account
}

/**
 * Processor's suggestion for movement purpose (hint for classifier)
 */
export enum MovementHint {
  FEE_ONLY = 'FEE_ONLY',
  INTEREST = 'INTEREST',
  REWARD = 'REWARD',
  TRADE_FEE = 'TRADE_FEE',
  TRADE_PRINCIPAL = 'TRADE_PRINCIPAL',
  TRANSFER_AMOUNT = 'TRANSFER_AMOUNT',
  TRANSFER_FEE = 'TRANSFER_FEE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Additional context for movement classification
 */
export interface MovementMetadata {
  // Account Context
  accountId?: string; // Specific account for multi-account scenarios

  // Audit Trail
  blockHash?: string; // Blockchain block hash
  confirmations?: number; // Blockchain confirmations

  executionPrice?: DecimalString; // Price at which movement occurred
  fromAddress?: string; // Source address
  gasPrice?: DecimalString; // Gas price paid
  // Network Context (for blockchain)
  gasUsed?: number; // Gas consumed

  // Transaction Context
  orderType?: OrderType; // MARKET, LIMIT, STOP, etc.
  toAddress?: string; // Destination address

  tradingPair?: string; // BTC/USD, ETH/USDC, etc.
  transactionHash?: string; // Blockchain transaction hash
  // Classification Context
  venue?: string; // Specific trading venue or DEX
}

/**
 * ProcessedTransaction with finalized movement purposes and classification metadata
 */
export interface ClassifiedTransaction {
  // Audit Information
  classificationInfo: ClassificationInfo;

  // Classification Metadata
  classifiedAt: Date;

  classifierVersion: string;
  // Classifications
  movements: ClassifiedMovement[];

  // Base Transaction
  processedTransaction: ProcessedTransaction;
}

/**
 * Movement with assigned business purpose
 */
export interface ClassifiedMovement {
  // Classification Metadata
  confidence: number; // 0.0-1.0 confidence score

  // Original Movement
  movement: Movement;

  // Assigned Purpose
  purpose: MovementPurpose;
  reasoning?: string; // Human-readable explanation
  ruleId: string; // Identifier of rule used
}

/**
 * Comprehensive enumeration of business purposes for movement classification
 */
export enum MovementPurpose {
  ADJUSTMENT = 'ADJUSTMENT', // Exchange adjustments
  AIRDROP = 'AIRDROP', // Token airdrops

  BORROWING = 'BORROWING', // Borrowing operations
  COLLATERAL = 'COLLATERAL', // Collateral deposits
  // Administrative
  DEPOSIT = 'DEPOSIT', // Fiat/crypto deposits

  DIVIDEND = 'DIVIDEND', // Dividend payments
  // Special Cases
  DUST_CONVERSION = 'DUST_CONVERSION', // Small balance conversions

  FORK = 'FORK', // Blockchain fork events
  FUNDING_FEE = 'FUNDING_FEE', // Perpetual funding fees
  // Network Operations
  GAS_FEE = 'GAS_FEE', // Blockchain gas costs
  INTEREST = 'INTEREST', // Interest payments
  LENDING = 'LENDING', // Lending operations

  LIQUIDATION = 'LIQUIDATION', // Liquidation events
  // DeFi Operations
  LIQUIDITY_PROVISION = 'LIQUIDITY_PROVISION', // LP token creation
  LIQUIDITY_REMOVAL = 'LIQUIDITY_REMOVAL', // LP token burning
  // Margin and Derivatives
  MARGIN_FEE = 'MARGIN_FEE', // Margin trading fees
  MINING_REWARD = 'MINING_REWARD', // Mining rewards

  NETWORK_FEE = 'NETWORK_FEE', // General network fees
  OTHER = 'OTHER', // Fallback for unclassified
  // Trading
  PRINCIPAL = 'PRINCIPAL', // Main trade amount

  // Rewards and Staking
  STAKING_REWARD = 'STAKING_REWARD', // Staking rewards
  TRADING_FEE = 'TRADING_FEE', // Exchange trading fees
  TRANSFER_FEE = 'TRANSFER_FEE', // Network/transfer fees

  TRANSFER_RECEIVED = 'TRANSFER_RECEIVED', // Transfer from external account
  // Transfers
  TRANSFER_SENT = 'TRANSFER_SENT', // Transfer to external account
  WITHDRAWAL = 'WITHDRAWAL', // Fiat/crypto withdrawals
}

/**
 * Audit metadata for classification decisions
 */
export interface ClassificationInfo {
  appliedRules: AppliedRule[]; // All rules evaluated
  lowConfidenceMovements: string[]; // Movement IDs with low confidence

  // Audit Trail
  manualOverrides?: ManualOverride[]; // Any manual classifications
  // Confidence Metrics
  overallConfidence: number; // 0.0-1.0 overall confidence

  reprocessingHistory?: ReprocessingEvent[]; // Previous classifications
  // Rule Tracking
  ruleSetVersion: string; // Version of classification rules
}

/**
 * Record of a classification rule evaluation
 */
export interface AppliedRule {
  confidence: number; // Rule-specific confidence
  matched: boolean; // Whether rule matched
  reasoning: string; // Why rule matched/didn't match
  ruleId: string; // Unique rule identifier
  ruleName: string; // Human-readable rule name
}

/**
 * Transaction source information
 */
export interface TransactionSource {
  apiVersion?: string; // Provider API version
  name: string; // Kraken, Bitcoin, Ethereum, etc.
  type: SourceType; // EXCHANGE, BLOCKCHAIN, CSV, etc.
}

/**
 * Source type enumeration
 */
export enum SourceType {
  BLOCKCHAIN = 'BLOCKCHAIN',
  CSV_IMPORT = 'CSV_IMPORT',
  EXCHANGE = 'EXCHANGE',
  MANUAL_ENTRY = 'MANUAL_ENTRY',
}

/**
 * Tagged union capturing source-specific metadata
 */
export type SourceDetails = ExchangeDetails | BlockchainDetails | CsvDetails | ManualDetails;

/**
 * Exchange-specific transaction details
 */
export interface ExchangeDetails {
  executionPrice?: DecimalString; // Execution price
  orderId?: string; // Exchange order identifier
  orderType?: OrderType; // Order type
  symbol?: string; // Trading pair symbol
  tradeId?: string; // Exchange trade identifier
  type: 'EXCHANGE';
}

/**
 * Blockchain-specific transaction details
 */
export interface BlockchainDetails {
  blockNumber?: number; // Block number
  fromAddress?: string; // Source address
  gasPrice?: DecimalString; // Gas price
  gasUsed?: number; // Gas consumed
  network: string; // bitcoin, ethereum, solana, etc.
  toAddress?: string; // Destination address
  txHash: string; // Transaction hash
  type: 'BLOCKCHAIN';
}

/**
 * CSV import-specific details
 */
export interface CsvDetails {
  fileName: string; // Source CSV file name
  headers: string[]; // CSV headers for reference
  rowNumber: number; // Row number in CSV
  type: 'CSV_IMPORT';
}

/**
 * Manual entry-specific details
 */
export interface ManualDetails {
  enteredBy: string; // User who entered the transaction
  entryTimestamp: Date; // When the entry was made
  notes?: string; // Optional notes
  type: 'MANUAL_ENTRY';
}

/**
 * Transaction event type classification
 */
export enum TransactionEventType {
  ADJUSTMENT = 'ADJUSTMENT', // Balance adjustments
  DEPOSIT = 'DEPOSIT', // Fiat/crypto deposits
  FEE_PAYMENT = 'FEE_PAYMENT', // Fee-only transactions
  LENDING = 'LENDING', // DeFi lending
  OTHER = 'OTHER', // Fallback category
  REWARD = 'REWARD', // Staking/mining rewards
  STAKING = 'STAKING', // Staking operations
  SWAP = 'SWAP', // Token swaps
  TRADE = 'TRADE', // Buy/sell operations
  TRANSFER = 'TRANSFER', // Asset transfers
  WITHDRAWAL = 'WITHDRAWAL', // Fiat/crypto withdrawals
}

/**
 * Order type enumeration
 */
export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
  OTHER = 'OTHER',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
  TRAILING_STOP = 'TRAILING_STOP',
}

/**
 * Validation status for processed transactions
 */
export enum ValidationStatus {
  ERROR = 'ERROR',
  PENDING = 'PENDING',
  VALID = 'VALID',
  WARNING = 'WARNING',
}

/**
 * Manual classification override record
 */
export interface ManualOverride {
  movementId: string;
  originalPurpose: MovementPurpose;
  overrideBy: string;
  overridePurpose: MovementPurpose;
  overrideReason: string;
  overrideTimestamp: Date;
}

/**
 * Reprocessing event record
 */
export interface ReprocessingEvent {
  newClassification: MovementPurpose;
  previousClassification: MovementPurpose;
  reprocessingId: string;
  reprocessingReason: string;
  reprocessingTimestamp: Date;
  ruleSetVersionAfter: string;
  ruleSetVersionBefore: string;
}

import type { ImportSessionStatus, ProcessingStatus, SourceType } from '@exitbook/core';
import type { Generated, ColumnType } from 'kysely';

/**
 * Database schema definitions
 * PostgreSQL-compatible design with proper relationships and standards compliance
 */

// PostgreSQL-compatible custom column types
export type DecimalString = ColumnType<string, string, string>; // Keep TEXT for financial precision
export type DateTime = ColumnType<string, string | Date, string>; // ISO 8601 strings: '2024-03-15T10:30:00.000Z'
export type JSONString = ColumnType<unknown, string, string>;

/**
 * Users table - tracks who is using the application and tracking accounts
 */
export interface UsersTable {
  id: Generated<number>;
  created_at: DateTime;
}

/**
 * Accounts table - persistent account metadata for exchanges and blockchains
 */
export interface AccountsTable {
  id: Generated<number>;
  user_id: number | null; // FK to users.id, NULL for tracking-only accounts
  parent_account_id: number | null; // FK to accounts.id, NULL for top-level accounts, set for derived address child accounts
  account_type: string; // 'blockchain' | 'exchange-api' | 'exchange-csv'
  source_name: string; // 'kraken', 'bitcoin', 'ethereum', etc.
  identifier: string; // address/xpub for blockchain, apiKey for exchange-api, CSV directory path for exchange-csv
  provider_name: string | null; // preferred provider for blockchain imports
  credentials: JSONString | null; // JSON: ExchangeCredentials for exchange-api accounts only
  last_cursor: JSONString | null; // JSON: Record<operationType, CursorState>
  last_balance_check_at: DateTime | null;
  verification_metadata: JSONString | null;
  metadata: JSONString | null; // JSON: Account metadata (e.g., xpub derivation info)
  created_at: DateTime;
  updated_at: DateTime | null;
}

/**
 * Import sessions table - tracks import execution events
 * Each session represents a single import run (manual or scheduled)
 */
export interface ImportSessionsTable {
  id: Generated<number>;
  account_id: number; // FK to accounts.id

  // Session lifecycle
  status: ImportSessionStatus;
  started_at: DateTime;
  completed_at: DateTime | null;
  duration_ms: number | null;

  // Session results
  transactions_imported: number;
  transactions_skipped: number;

  // Error handling
  error_message: string | null;
  error_details: JSONString | null;

  // Audit trail
  created_at: DateTime;
  updated_at: DateTime | null;
}

/**
 * External transaction data table - stores unprocessed transaction data from sources
 * Scoped by account - each account owns its raw transaction data
 */
export interface RawTransactionTable {
  created_at: DateTime;

  id: Generated<number>;
  // Foreign key relationship
  account_id: number; // FK to accounts.id

  provider_name: string;

  // Transaction identification
  event_id: string; // Unique transaction ID from exchange/blockchain
  blockchain_transaction_hash: string | null; // On-chain transaction hash for deduplication (null for exchange transactions)
  timestamp: number; // Event timestamp in Unix milliseconds

  // Source metadata
  source_address: string | null; // For blockchain transactions (wallet address)
  transaction_type_hint: string | null; // For exchange transactions (e.g., 'deposit', 'withdrawal', 'spot_order')

  // Data storage
  provider_data: JSONString; // Raw data from source
  normalized_data: JSONString; // Normalized data

  // Processing status
  processing_status: ProcessingStatus;
  processed_at: DateTime | null;
}

/**
 * Transactions table - stores transactions from all sources with standardized structure
 * Using TEXT for decimal values to preserve precision
 * Scoped by account - each account owns its processed transactions
 */
export interface TransactionsTable {
  // Core identification
  id: Generated<number>;
  account_id: number; // FK to accounts.id
  source_name: string;
  source_type: SourceType;
  external_id: string | null; // hash, transaction ID, etc.

  // Transaction metadata
  // Unified status supporting both blockchain ('success', 'pending', 'failed')
  // and exchange ('open', 'closed', 'canceled', 'success', 'pending', 'failed') statuses
  transaction_status: 'pending' | 'success' | 'failed' | 'open' | 'closed' | 'canceled';
  transaction_datetime: DateTime;
  from_address: string | null;
  to_address: string | null;

  // Notes (Array<TransactionNote>)
  notes_json: JSONString | null;

  // Spam detection
  is_spam: boolean; // SQLite: INTEGER (0/1), default 0

  // Accounting exclusions
  excluded_from_accounting: boolean; // Skip from price enrichment and cost basis (e.g., scam tokens)

  // Structured movements
  movements_inflows: JSONString | null; // Array<{assetSymbol: string, amount: Decimal}>
  movements_outflows: JSONString | null; // Array<{assetSymbol: string, amount: Decimal}>

  // Structured fees (JSON: Array<FeeMovement>)
  // Each fee: { assetSymbol, amount, scope, settlement, priceAtTxTime? }
  fees: JSONString | null;

  // Enhanced operation classification
  operation_category: 'trade' | 'transfer' | 'staking' | 'defi' | 'fee' | 'governance' | null;
  operation_type:
    | 'buy'
    | 'sell'
    | 'deposit'
    | 'withdrawal'
    | 'stake'
    | 'unstake'
    | 'reward'
    | 'swap'
    | 'fee'
    | 'batch'
    | 'transfer'
    | 'refund'
    | 'vote'
    | 'proposal'
    | 'airdrop'
    | null;

  // Blockchain metadata
  blockchain_name: string | null;
  blockchain_block_height: number | null;
  blockchain_transaction_hash: string | null;
  blockchain_is_confirmed: boolean | null;

  // Timestamps
  created_at: DateTime;
  updated_at: DateTime | null;
}

/**
 * Transaction links - tracks connections between related transactions
 * Used to propagate cost basis from exchanges to blockchain wallets
 */
export interface TransactionLinksTable {
  id: string; // UUID
  source_transaction_id: number; // FK to transactions.id (withdrawal/send)
  target_transaction_id: number; // FK to transactions.id (deposit/receive)
  asset: string; // Transferred asset symbol (e.g., 'BTC', 'ETH')
  source_amount: DecimalString; // Gross outflow amount (before fees deducted)
  target_amount: DecimalString; // Net received amount (after fees)
  link_type: 'exchange_to_blockchain' | 'blockchain_to_blockchain' | 'exchange_to_exchange' | 'blockchain_internal';
  confidence_score: DecimalString; // 0-1
  match_criteria_json: JSONString; // MatchCriteria
  status: 'suggested' | 'confirmed' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: DateTime | null;
  created_at: DateTime;
  updated_at: DateTime;
  metadata_json: JSONString | null;
}

/**
 * Token metadata table - stores token information by contract address
 * Used by processors to enrich transaction data with token details
 */
export interface TokenMetadataTable {
  id: Generated<number>;
  blockchain: string;
  contract_address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  logo_url: string | null;
  // Professional spam detection (SQLite uses INTEGER for booleans: 0/1)
  possible_spam: number | null;
  verified_contract: number | null;
  // Additional metadata for pattern-based detection
  description: string | null;
  external_url: string | null;
  // Additional useful fields from providers
  total_supply: string | null;
  created_at_provider: string | null;
  block_number: number | null;
  source: string;
  refreshed_at: DateTime;
}

/**
 * Symbol index table - enables reverse lookup from symbol to contract addresses
 * Supports multiple contracts with the same symbol
 */
export interface SymbolIndexTable {
  id: Generated<number>;
  blockchain: string;
  symbol: string;
  contract_address: string;
  created_at: DateTime;
}

/**
 * Main database interface combining all tables
 */
export interface DatabaseSchema {
  users: UsersTable;
  accounts: AccountsTable;
  raw_transactions: RawTransactionTable;
  import_sessions: ImportSessionsTable;
  symbol_index: SymbolIndexTable;
  token_metadata: TokenMetadataTable;
  transaction_links: TransactionLinksTable;
  transactions: TransactionsTable;
}

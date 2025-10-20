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
 * Import sessions table - tracks import session metadata and execution details
 */
export interface ImportSessionsTable {
  completed_at: DateTime | null;
  created_at: DateTime;
  duration_ms: number | null;
  error_details: JSONString | null;
  // Error handling
  error_message: string | null;

  id: Generated<number>;
  // Import parameters and results
  import_params: JSONString;
  import_result_metadata: JSONString;
  provider_id: string | null;

  // Session identification
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  started_at: DateTime;
  // Status and metrics
  status: 'started' | 'completed' | 'failed' | 'cancelled';

  transactions_failed: number;
  transactions_imported: number;

  updated_at: DateTime | null;

  // Balance verification
  last_balance_check_at: DateTime | null;
  verification_metadata: JSONString | null;
}

/**
 * External transaction data table - stores unprocessed transaction data from sources
 */
export interface ExternalTransactionDataTable {
  created_at: DateTime;

  id: Generated<number>;
  // Foreign key relationship
  import_session_id: number; // FK to import_sessions.id

  provider_id: string | null;

  // Transaction identification and cursor (for auto-incremental imports)
  external_id: string | null; // Unique transaction ID from exchange/blockchain
  cursor: JSONString | null; // Cursor for resuming imports (ExchangeCursor with per-operation timestamps)

  // Data storage
  raw_data: JSONString; // Raw data from source
  normalized_data: JSONString; // Normalized data

  // Processing status
  processing_status: 'pending' | 'processed' | 'failed' | 'skipped';
  processed_at: DateTime | null;
  processing_error: string | null;

  metadata: JSONString | null;
}

/**
 * Transactions table - stores transactions from all sources with standardized structure
 * Using TEXT for decimal values to preserve precision
 */
export interface TransactionsTable {
  // Core identification
  id: Generated<number>;
  import_session_id: number; // FK to import_sessions.id
  wallet_address_id: number | null; // FK to wallet_addresses.id
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  external_id: string | null; // hash, transaction ID, etc.

  // Transaction metadata
  transaction_status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
  transaction_datetime: DateTime;
  from_address: string | null;
  to_address: string | null;
  verified: boolean;

  // Optional price data (for trades)
  price: DecimalString | null;
  price_currency: string | null;

  // Notes and metadata
  note_type: string | null;
  note_severity: 'info' | 'warning' | 'error' | null;
  note_message: string | null;
  note_metadata: JSONString | null;

  // Audit trail
  raw_normalized_data: JSONString; // Keep for debugging/audit

  // Structured movements
  movements_inflows: JSONString | null; // Array<{asset: string, amount: Decimal}>
  movements_outflows: JSONString | null; // Array<{asset: string, amount: Decimal}>

  // Structured fees
  fees_network: JSONString | null; // Money type
  fees_platform: JSONString | null; // Money type
  fees_total: JSONString | null; // Money type

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
 * Wallet addresses - store user's wallet addresses for tracking and consolidation
 */
export interface WalletAddressesTable {
  // Address information
  address: string;

  address_type: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain: string;

  created_at: DateTime;
  id: Generated<number>;
  is_active: boolean;

  // User-defined metadata
  label: string | null;
  notes: string | null;
  updated_at: DateTime | null;
}

/**
 * Import session errors - tracks validation and processing errors
 */
export interface ImportSessionErrorsTable {
  created_at: DateTime;
  error_details: JSONString | null;
  // Error information
  error_message: string;
  error_type: 'validation' | 'fetch' | 'processing';
  // Failed item data
  failed_item_data: JSONString | null;

  id: Generated<number>;
  // Foreign key relationship
  import_session_id: number; // FK to import_sessions.id

  occurred_at: DateTime;
}

/**
 * Cost basis calculations - tracks calculation runs and summary results
 */
export interface CostBasisCalculationsTable {
  id: string; // UUID
  calculation_date: number; // Unix timestamp
  config_json: JSONString; // CostBasisConfig
  start_date: number | null; // Unix timestamp
  end_date: number | null; // Unix timestamp
  total_proceeds: DecimalString;
  total_cost_basis: DecimalString;
  total_gain_loss: DecimalString;
  total_taxable_gain_loss: DecimalString; // After jurisdiction rules (e.g., 50% for Canada)
  assets_processed: JSONString; // Array of asset symbols
  transactions_processed: number;
  lots_created: number;
  disposals_processed: number;
  status: 'pending' | 'completed' | 'failed';
  error_message: string | null;
  created_at: number; // Unix timestamp
  completed_at: number | null; // Unix timestamp
  metadata_json: JSONString | null;
}

/**
 * Acquisition lots - tracks acquisition transactions for cost basis matching
 */
export interface AcquisitionLotsTable {
  id: string; // UUID
  calculation_id: string; // FK to cost_basis_calculations.id
  acquisition_transaction_id: number; // FK to transactions.id
  asset: string; // BTC, ETH, etc.
  quantity: DecimalString;
  cost_basis_per_unit: DecimalString;
  total_cost_basis: DecimalString;
  acquisition_date: number; // Unix timestamp
  method: 'fifo' | 'lifo' | 'specific-id' | 'average-cost';
  remaining_quantity: DecimalString;
  status: 'open' | 'partially_disposed' | 'fully_disposed';
  created_at: number; // Unix timestamp
  updated_at: number; // Unix timestamp
  metadata_json: JSONString | null;
}

/**
 * Lot disposals - tracks disposal matches and capital gains/losses
 */
export interface LotDisposalsTable {
  id: string; // UUID
  lot_id: string; // FK to acquisition_lots.id
  disposal_transaction_id: number; // FK to transactions.id
  quantity_disposed: DecimalString;
  proceeds_per_unit: DecimalString;
  total_proceeds: DecimalString;
  cost_basis_per_unit: DecimalString;
  total_cost_basis: DecimalString;
  gain_loss: DecimalString;
  disposal_date: number; // Unix timestamp
  holding_period_days: number;
  tax_treatment_category: string | null; // null (Canada), 'short_term'/'long_term' (US)
  created_at: number; // Unix timestamp
  metadata_json: JSONString | null;
}

/**
 * Transaction links - tracks connections between related transactions
 * Used to propagate cost basis from exchanges to blockchain wallets
 */
export interface TransactionLinksTable {
  id: string; // UUID
  source_transaction_id: number; // FK to transactions.id (withdrawal/send)
  target_transaction_id: number; // FK to transactions.id (deposit/receive)
  link_type: 'exchange_to_blockchain' | 'blockchain_to_blockchain' | 'exchange_to_exchange';
  confidence_score: DecimalString; // 0-1
  match_criteria_json: JSONString; // MatchCriteria
  status: 'suggested' | 'confirmed' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: number | null; // Unix timestamp
  created_at: number; // Unix timestamp
  updated_at: number; // Unix timestamp
  metadata_json: JSONString | null;
}

/**
 * Main database interface combining all tables
 */
export interface DatabaseSchema {
  acquisition_lots: AcquisitionLotsTable;
  cost_basis_calculations: CostBasisCalculationsTable;
  external_transaction_data: ExternalTransactionDataTable;
  import_session_errors: ImportSessionErrorsTable;
  import_sessions: ImportSessionsTable;
  lot_disposals: LotDisposalsTable;
  transaction_links: TransactionLinksTable;
  transactions: TransactionsTable;
  wallet_addresses: WalletAddressesTable;
}

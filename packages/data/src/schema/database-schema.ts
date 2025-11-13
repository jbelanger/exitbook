import type { DataSourceStatus, ProcessingStatus, SourceType } from '@exitbook/core';
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
 * Import sessions table - tracks data source  metadata and execution details
 */
export interface DataSourcesTable {
  completed_at: DateTime | null;
  created_at: DateTime;
  duration_ms: number | null;

  // Error handling
  error_details: JSONString | null;
  error_message: string | null;

  id: Generated<number>;
  // Import parameters and results
  import_params: JSONString;
  import_result_metadata: JSONString;

  // Session identification
  source_id: string;
  source_type: SourceType;

  // Status and metrics
  status: DataSourceStatus;

  started_at: DateTime;
  updated_at: DateTime | null;

  /**
   * Map of cursor states per operation type for resumable imports
   * Stores Record<operationType, CursorState> as JSON
   *
   * Operation types:
   * - Blockchains: 'normal', 'internal', 'token'
   * - Exchanges: 'trade', 'deposit', 'withdrawal', etc.
   *
   * This is the AUTHORITATIVE cursor for resume operations:
   * - Read on import start: `SELECT last_cursor FROM data_sources WHERE id = ?`
   * - Write after EACH batch: `UPDATE data_sources SET last_cursor = ? WHERE id = ?`
   *
   * Schema validation: z.record(z.string(), CursorStateSchema) from @exitbook/core/schemas
   */
  last_cursor: JSONString | null;

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
  data_source_id: number; // FK to data_sources.id

  provider_name: string;

  // Transaction identification
  external_id: string; // Unique transaction ID from exchange/blockchain

  // Source metadata
  source_address: string | null; // For blockchain transactions (wallet address)
  transaction_type_hint: string | null; // For exchange transactions (e.g., 'deposit', 'withdrawal', 'spot_order')

  // Data storage
  raw_data: JSONString; // Raw data from source
  normalized_data: JSONString; // Normalized data

  // Processing status
  processing_status: ProcessingStatus;
  processed_at: DateTime | null;
  processing_error: string | null;
}

/**
 * Transactions table - stores transactions from all sources with standardized structure
 * Using TEXT for decimal values to preserve precision
 */
export interface TransactionsTable {
  // Core identification
  id: Generated<number>;
  data_source_id: number; // FK to data_sources.id
  source_id: string;
  source_type: SourceType;
  external_id: string | null; // hash, transaction ID, etc.

  // Transaction metadata
  // Unified status supporting both blockchain ('success', 'pending', 'failed')
  // and exchange ('open', 'closed', 'canceled', 'success', 'pending', 'failed') statuses
  transaction_status: 'pending' | 'success' | 'failed' | 'open' | 'closed' | 'canceled';
  transaction_datetime: DateTime;
  from_address: string | null;
  to_address: string | null;

  // Notes and metadata
  note_type: string | null;
  note_severity: 'info' | 'warning' | 'error' | null;
  note_message: string | null;
  note_metadata: JSONString | null;

  // Accounting exclusions
  excluded_from_accounting: boolean; // Skip from price enrichment and cost basis (e.g., scam tokens)

  // Audit trail
  raw_normalized_data: JSONString; // Keep for debugging/audit

  // Structured movements
  movements_inflows: JSONString | null; // Array<{asset: string, amount: Decimal}>
  movements_outflows: JSONString | null; // Array<{asset: string, amount: Decimal}>

  // Structured fees (JSON: Array<FeeMovement>)
  // Each fee: { asset, amount, scope, settlement, priceAtTxTime? }
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
 * Cost basis calculations - tracks calculation runs and summary results
 */
export interface CostBasisCalculationsTable {
  id: string; // UUID
  calculation_date: DateTime;
  config_json: JSONString; // CostBasisConfig
  start_date: DateTime | null;
  end_date: DateTime | null;
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
  created_at: DateTime;
  completed_at: DateTime | null;
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
  acquisition_date: DateTime;
  method: 'fifo' | 'lifo' | 'specific-id' | 'average-cost';
  remaining_quantity: DecimalString;
  status: 'open' | 'partially_disposed' | 'fully_disposed';
  created_at: DateTime;
  updated_at: DateTime;
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
  disposal_date: DateTime;
  holding_period_days: number;
  tax_treatment_category: string | null; // null (Canada), 'short_term'/'long_term' (US)
  created_at: DateTime;
  metadata_json: JSONString | null;
}

/**
 * Lot transfers - tracks cost basis transfers between lots via transaction links
 * Used when linked transactions (e.g., exchange withdrawal → blockchain deposit) propagate cost basis
 */
export interface LotTransfersTable {
  id: string; // UUID
  calculation_id: string; // FK to cost_basis_calculations.id
  source_lot_id: string; // FK to acquisition_lots.id
  link_id: string; // FK to transaction_links.id
  quantity_transferred: DecimalString;
  cost_basis_per_unit: DecimalString;
  source_transaction_id: number; // FK to transactions.id (withdrawal/send)
  target_transaction_id: number; // FK to transactions.id (deposit/receive)
  metadata_json: JSONString | null;
  created_at: DateTime;
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
  link_type: 'exchange_to_blockchain' | 'blockchain_to_blockchain' | 'exchange_to_exchange';
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
  acquisition_lots: AcquisitionLotsTable;
  cost_basis_calculations: CostBasisCalculationsTable;
  external_transaction_data: ExternalTransactionDataTable;
  data_sources: DataSourcesTable;
  lot_disposals: LotDisposalsTable;
  lot_transfers: LotTransfersTable;
  symbol_index: SymbolIndexTable;
  token_metadata: TokenMetadataTable;
  transaction_links: TransactionLinksTable;
  transactions: TransactionsTable;
}

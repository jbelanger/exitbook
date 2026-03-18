import type { ImportSessionStatus, ProcessingStatus, SourceType } from '@exitbook/core';
import type { Generated, ColumnType } from '@exitbook/sqlite';

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
  tx_fingerprint: string; // Canonical persisted transaction identity

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
 * Transaction movements table - normalized storage for asset movements and fees
 * Each row represents either an inflow, outflow, or fee
 */
export interface TransactionMovementsTable {
  id: Generated<number>;
  transaction_id: number; // FK to transactions.id
  position: number; // Order within transaction (0-indexed)
  movement_type: 'inflow' | 'outflow' | 'fee';
  movement_fingerprint: string; // Canonical persisted movement identity (e.g. movement:<txFingerprint>:outflow:0)
  asset_id: string;
  asset_symbol: string;
  // Amount fields (inflow/outflow only)
  gross_amount: DecimalString | null;
  net_amount: DecimalString | null;
  fee_amount: DecimalString | null;
  // Fee-specific fields (fee only)
  fee_scope: 'network' | 'platform' | 'spread' | 'tax' | 'other' | null;
  fee_settlement: 'on-chain' | 'balance' | 'external' | null;
  // Price metadata (all types)
  price_amount: DecimalString | null;
  price_currency: string | null;
  price_source: string | null;
  price_fetched_at: DateTime | null;
  price_granularity: 'exact' | 'minute' | 'hour' | 'day' | null;
  fx_rate_to_usd: DecimalString | null;
  fx_source: string | null;
  fx_timestamp: DateTime | null;
}

/**
 * Transaction links - tracks connections between related transactions
 * Used to propagate cost basis from exchanges to blockchain wallets
 */
export interface TransactionLinksTable {
  id: Generated<number>;
  source_transaction_id: number; // FK to transactions.id (withdrawal/send)
  target_transaction_id: number; // FK to transactions.id (deposit/receive)
  asset: string; // Transferred asset symbol (e.g., 'BTC', 'ETH')
  source_asset_id: string; // Source movement asset ID (e.g., 'exchange:kraken:btc')
  target_asset_id: string; // Target movement asset ID (e.g., 'blockchain:bitcoin:native')
  source_amount: DecimalString; // Linked source amount before any implied same-asset transfer fee
  target_amount: DecimalString; // Net received amount after any implied same-asset transfer fee
  implied_fee_amount: DecimalString | null; // Inferred same-asset transfer fee not modeled as a fee movement
  source_movement_fingerprint: string; // Deterministic movement identity (e.g. movement:<txFingerprint>:outflow:0)
  target_movement_fingerprint: string; // Deterministic movement identity (e.g. movement:<txFingerprint>:inflow:0)
  link_type:
    | 'exchange_to_blockchain'
    | 'blockchain_to_exchange'
    | 'blockchain_to_blockchain'
    | 'exchange_to_exchange'
    | 'blockchain_internal';
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
 * Projection state table - tracks lifecycle state of persisted derived datasets.
 * Replaces the singleton raw_data_processed_state with a generalized model.
 */
export interface ProjectionStateTable {
  projection_id: string;
  scope_key: string; // Default '__global__'
  status: string; // 'fresh' | 'stale' | 'building' | 'failed'
  last_built_at: DateTime | null;
  last_invalidated_at: DateTime | null;
  invalidated_by: string | null;
  metadata_json: JSONString | null;
}

export interface CostBasisSnapshotsTable {
  scope_key: string;
  snapshot_id: string;
  storage_schema_version: number;
  calculation_engine_version: number;
  artifact_kind: string;
  links_built_at: DateTime;
  asset_review_built_at: DateTime;
  prices_last_mutated_at: DateTime | null;
  exclusion_fingerprint: string;
  calculation_id: string;
  jurisdiction: string;
  method: string;
  tax_year: number;
  display_currency: string;
  start_date: string;
  end_date: string;
  artifact_json: JSONString;
  debug_json: JSONString;
  created_at: DateTime;
  updated_at: DateTime;
}

export interface CostBasisFailureSnapshotsTable {
  scope_key: string;
  consumer: string;
  snapshot_id: string;
  links_status: string;
  links_built_at: DateTime | null;
  asset_review_status: string;
  asset_review_built_at: DateTime | null;
  prices_last_mutated_at: DateTime | null;
  exclusion_fingerprint: string;
  jurisdiction: string;
  method: string;
  tax_year: number;
  display_currency: string;
  start_date: string;
  end_date: string;
  error_name: string;
  error_message: string;
  error_stack: string | null;
  debug_json: JSONString;
  created_at: DateTime;
  updated_at: DateTime;
}

export interface BalanceSnapshotsTable {
  scope_account_id: number;
  calculated_at: DateTime | null;
  last_refresh_at: DateTime | null;
  verification_status: string;
  coverage_status: string | null;
  coverage_confidence: string | null;
  requested_address_count: number | null;
  successful_address_count: number | null;
  failed_address_count: number | null;
  total_asset_count: number | null;
  parsed_asset_count: number | null;
  failed_asset_count: number | null;
  match_count: number;
  warning_count: number;
  mismatch_count: number;
  status_reason: string | null;
  suggestion: string | null;
  last_error: string | null;
  created_at: DateTime;
  updated_at: DateTime | null;
}

export interface BalanceSnapshotAssetsTable {
  scope_account_id: number;
  asset_id: string;
  asset_symbol: string;
  calculated_balance: DecimalString;
  live_balance: DecimalString | null;
  difference: DecimalString | null;
  comparison_status: string | null;
  excluded_from_accounting: boolean;
}

export interface AssetReviewStateTable {
  asset_id: string;
  review_status: string;
  reference_status: string;
  warning_summary: string | null;
  evidence_fingerprint: string;
  confirmed_evidence_fingerprint: string | null;
  confirmation_is_stale: boolean;
  accounting_blocked: boolean;
  computed_at: DateTime;
}

export interface AssetReviewEvidenceTable {
  id: Generated<number>;
  asset_id: string;
  position: number;
  kind: string;
  severity: string;
  message: string;
  metadata_json: JSONString | null;
}

/**
 * Main database interface combining all tables
 */
export interface DatabaseSchema {
  users: UsersTable;
  accounts: AccountsTable;
  raw_transactions: RawTransactionTable;
  import_sessions: ImportSessionsTable;
  transaction_movements: TransactionMovementsTable;
  transaction_links: TransactionLinksTable;
  transactions: TransactionsTable;
  projection_state: ProjectionStateTable;
  cost_basis_snapshots: CostBasisSnapshotsTable;
  cost_basis_failure_snapshots: CostBasisFailureSnapshotsTable;
  balance_snapshots: BalanceSnapshotsTable;
  balance_snapshot_assets: BalanceSnapshotAssetsTable;
  asset_review_state: AssetReviewStateTable;
  asset_review_evidence: AssetReviewEvidenceTable;
}

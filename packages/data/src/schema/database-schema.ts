import type { Generated, ColumnType } from 'kysely';

/**
 * Modernized database schema definitions for Kysely
 * PostgreSQL-compatible design with proper relationships and standards compliance
 */

// PostgreSQL-compatible custom column types
export type DecimalString = ColumnType<string, string, string>; // Keep TEXT for financial precision
export type DateTime = ColumnType<string, string | Date, string>; // ISO 8601 strings: '2024-03-15T10:30:00.000Z'
export type JSONString = ColumnType<string, string, string>;

/**
 * Import sessions table - tracks import session metadata and execution details
 */
export interface ImportSessionsTable {
  completed_at: DateTime | null;

  // Modern datetime handling (PostgreSQL compatible)
  created_at: DateTime;
  duration_ms: number | null;
  error_details: JSONString | null;
  // Error handling
  error_message: string | null;

  id: Generated<number>;
  provider_id: string | null;
  // Metadata
  session_metadata: JSONString | null;

  // Session identification
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  started_at: DateTime;
  // Status and metrics
  status: 'started' | 'completed' | 'failed' | 'cancelled';

  transactions_failed: number;
  transactions_imported: number;

  updated_at: DateTime | null;
}

/**
 * External transaction data table - stores unprocessed transaction data from sources
 */
export interface ExternalTransactionDataTable {
  // Modern datetime handling
  created_at: DateTime;

  id: Generated<number>;
  // Foreign key relationship
  import_session_id: number | null; // FK to import_sessions.id

  metadata: JSONString | null;

  processed_at: DateTime | null;
  processing_error: string | null;
  // Processing status
  processing_status: 'pending' | 'processed' | 'failed' | 'skipped';

  provider_id: string | null;
  // Data storage
  raw_data: JSONString;

  // Source information
  source_id: string;
  source_type: string;
}

/**
 * Transactions table - stores transactions from all sources with standardized structure
 * Using TEXT for decimal values to preserve precision
 */
export interface TransactionsTable {
  // Financial data (keep TEXT for precision)
  amount: DecimalString | null;

  amount_currency: string | null;
  // Modern datetime handling (PostgreSQL compatible)
  created_at: DateTime;
  external_id: string | null; // hash, transaction ID, etc.

  fee_cost: DecimalString | null;
  fee_currency: string | null;
  // Address information
  from_address: string | null;
  id: Generated<number>;
  import_session_id: number | null; // FK to import_sessions.id
  // Notes and metadata
  note_message: string | null;

  note_metadata: JSONString | null;
  note_severity: 'info' | 'warning' | 'error' | null;

  note_type: string | null;
  price: DecimalString | null;
  price_currency: string | null;

  // Audit trail
  raw_data: JSONString; // Keep for debugging/audit
  // Core identification
  source_id: string;
  source_type: 'exchange' | 'blockchain';

  symbol: string | null;
  to_address: string | null;

  transaction_datetime: DateTime;
  transaction_status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
  // Standardized enums
  transaction_type: 'trade' | 'transfer' | 'deposit' | 'withdrawal' | 'fee' | 'reward' | 'mining';
  updated_at: DateTime | null;

  verified: boolean;
  // Proper foreign keys
  wallet_address_id: number | null; // FK to wallet_addresses.id
}

/**
 * Balance snapshots - store point-in-time balance data
 */
export interface BalanceSnapshotsTable {
  // Balance data
  balance: DecimalString;

  // Modern datetime handling
  created_at: DateTime;
  currency: string;

  exchange: string;
  id: Generated<number>;
  snapshot_datetime: DateTime;
}

/**
 * Balance verification records - track verification results
 */
export interface BalanceVerificationsTable {
  actual_balance: DecimalString;

  // Modern datetime handling
  created_at: DateTime;
  // Verification data
  currency: string;

  difference: DecimalString;
  exchange: string;
  expected_balance: DecimalString;
  id: Generated<number>;
  status: 'match' | 'mismatch' | 'warning';
  verification_datetime: DateTime;
}

/**
 * Wallet addresses - store user's wallet addresses for tracking and consolidation
 */
export interface WalletAddressesTable {
  // Address information
  address: string;

  address_type: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain: string;

  // Modern datetime handling
  created_at: DateTime;
  id: Generated<number>;
  is_active: boolean;

  // User-defined metadata
  label: string | null;
  notes: string | null;
  updated_at: DateTime | null;
}

/**
 * Main database interface combining all tables
 */
export interface DatabaseSchema {
  balance_snapshots: BalanceSnapshotsTable;
  balance_verifications: BalanceVerificationsTable;
  external_transaction_data: ExternalTransactionDataTable;
  import_sessions: ImportSessionsTable;
  transactions: TransactionsTable;
  wallet_addresses: WalletAddressesTable;
}

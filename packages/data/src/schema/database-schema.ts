import type { Generated, ColumnType } from 'kysely';

/**
 * Database schema definitions
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
  completed_at: DateTime | undefined;
  created_at: DateTime;
  duration_ms: number | undefined;
  error_details: JSONString | undefined;
  // Error handling
  error_message: string | undefined;

  id: Generated<number>;
  provider_id: string | undefined;
  // Metadata
  session_metadata: JSONString | undefined;

  // Session identification
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  started_at: DateTime;
  // Status and metrics
  status: 'started' | 'completed' | 'failed' | 'cancelled';

  transactions_failed: number;
  transactions_imported: number;

  updated_at: DateTime | undefined;
}

/**
 * External transaction data table - stores unprocessed transaction data from sources
 */
export interface ExternalTransactionDataTable {
  created_at: DateTime;

  id: Generated<number>;
  // Foreign key relationship
  import_session_id: number | undefined; // FK to import_sessions.id

  metadata: JSONString | undefined;

  processed_at: DateTime | undefined;
  processing_error: string | undefined;
  // Processing status
  processing_status: 'pending' | 'processed' | 'failed' | 'skipped';

  provider_id: string | undefined;
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
  amount: DecimalString | undefined;

  amount_currency: string | undefined;
  created_at: DateTime;
  external_id: string | undefined; // hash, transaction ID, etc.

  fee_cost: DecimalString | undefined;
  fee_currency: string | undefined;
  // Address information
  from_address: string | undefined;
  id: Generated<number>;
  import_session_id: number | undefined; // FK to import_sessions.id
  // Notes and metadata
  note_message: string | undefined;

  note_metadata: JSONString | undefined;
  note_severity: 'info' | 'warning' | 'error' | undefined;

  note_type: string | undefined;
  price: DecimalString | undefined;
  price_currency: string | undefined;

  // Audit trail
  raw_data: JSONString; // Keep for debugging/audit
  // Core identification
  source_id: string;
  source_type: 'exchange' | 'blockchain';

  symbol: string | undefined;
  to_address: string | undefined;

  transaction_datetime: DateTime;
  transaction_status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
  // Standardized enums
  transaction_type: 'trade' | 'transfer' | 'deposit' | 'withdrawal' | 'fee' | 'reward' | 'mining';
  updated_at: DateTime | undefined;

  verified: boolean;
  // Proper foreign keys
  wallet_address_id: number | undefined; // FK to wallet_addresses.id
}

/**
 * Balance verification records - track verification results
 */
export interface BalanceVerificationsTable {
  actual_balance: DecimalString;

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

  created_at: DateTime;
  id: Generated<number>;
  is_active: boolean;

  // User-defined metadata
  label: string | undefined;
  notes: string | undefined;
  updated_at: DateTime | undefined;
}

/**
 * Main database interface combining all tables
 */
export interface DatabaseSchema {
  balance_verifications: BalanceVerificationsTable;
  external_transaction_data: ExternalTransactionDataTable;
  import_sessions: ImportSessionsTable;
  transactions: TransactionsTable;
  wallet_addresses: WalletAddressesTable;
}

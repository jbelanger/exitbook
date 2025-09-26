import type { Generated, ColumnType } from 'kysely';

/**
 * Database schema definitions for Kysely
 * These interfaces represent the exact structure of the SQLite database tables
 */

// Custom column types for better type safety
export type DecimalString = ColumnType<string, string, string>;
export type JSONString = ColumnType<string, string, string>;
export type UnixTimestamp = ColumnType<number, number, number>;
export type BooleanInt = ColumnType<boolean, 0 | 1, 0 | 1>;

/**
 * Import sessions table - tracks import session metadata and execution details
 */
export interface ImportSessionsTable {
  completed_at?: UnixTimestamp;
  created_at: Generated<UnixTimestamp>;
  duration_ms?: number;
  error_details?: JSONString;
  error_message?: string;
  id: Generated<number>;
  provider_id?: string;
  session_metadata?: JSONString;
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  started_at: UnixTimestamp;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  transactions_failed: number;
  transactions_imported: number;
  updated_at: Generated<UnixTimestamp>;
}

/**
 * External transaction data table - stores unprocessed transaction data from sources
 */
export interface ExternalTransactionDataTable {
  created_at: Generated<UnixTimestamp>;
  id: Generated<number>;
  import_session_id?: number;
  metadata?: JSONString;
  processed_at?: UnixTimestamp;
  processing_error?: string;
  processing_status?: string;
  provider_id?: string;
  raw_data: JSONString;
  source_id: string;
  source_type: string;
}

/**
 * Transactions table - stores transactions from all sources with standardized structure
 * Using TEXT for decimal values to preserve precision
 */
export interface TransactionsTable {
  amount?: DecimalString;
  amount_currency?: string;
  created_at: Generated<UnixTimestamp>;
  datetime?: string;
  fee_cost?: DecimalString;
  fee_currency?: string;
  from_address?: string;
  hash?: string;
  id: Generated<number>;
  note_message?: string;
  note_metadata?: JSONString;
  note_severity?: 'info' | 'warning' | 'error';
  note_type?: string;
  price?: DecimalString;
  price_currency?: string;
  raw_data: JSONString;
  source_id: string;
  status?: string;
  symbol?: string;
  timestamp: UnixTimestamp;
  to_address?: string;
  type: string;
  verified?: BooleanInt;
  wallet_id?: number;
}

/**
 * Balance snapshots - store point-in-time balance data
 */
export interface BalanceSnapshotsTable {
  balance: DecimalString;
  created_at: Generated<UnixTimestamp>;
  currency: string;
  exchange: string;
  id: Generated<number>;
  timestamp: UnixTimestamp;
}

/**
 * Balance verification records - track verification results
 */
export interface BalanceVerificationsTable {
  actual_balance: DecimalString;
  created_at: Generated<UnixTimestamp>;
  currency: string;
  difference: DecimalString;
  exchange: string;
  expected_balance: DecimalString;
  id: Generated<number>;
  status: 'match' | 'mismatch' | 'warning';
  timestamp: UnixTimestamp;
}

/**
 * Wallet addresses - store user's wallet addresses for tracking and consolidation
 */
export interface WalletAddressesTable {
  address: string;
  address_type: 'personal' | 'exchange' | 'contract' | 'unknown';
  blockchain: string;
  created_at: Generated<UnixTimestamp>;
  id: Generated<number>;
  is_active?: BooleanInt;
  label?: string;
  notes?: string;
  updated_at: Generated<UnixTimestamp>;
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

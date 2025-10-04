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
}

/**
 * External transaction data table - stores unprocessed transaction data from sources
 */
export interface ExternalTransactionDataTable {
  created_at: DateTime;

  id: Generated<number>;
  // Foreign key relationship
  import_session_id: number; // FK to import_sessions.id

  metadata: JSONString | null;

  processed_at: DateTime | null;
  processing_error: string | null;
  // Processing status
  processing_status: 'pending' | 'processed' | 'failed' | 'skipped';

  provider_id: string | null;
  // Data storage
  raw_data: JSONString;
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
  movements_inflows: JSONString | null; // Array<{asset: string, amount: Money}>
  movements_outflows: JSONString | null; // Array<{asset: string, amount: Money}>
  movements_primary_asset: string | null;
  movements_primary_amount: DecimalString | null;
  movements_primary_currency: string | null;
  movements_primary_direction: 'in' | 'out' | 'neutral' | null;

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
 * Main database interface combining all tables
 */
export interface DatabaseSchema {
  external_transaction_data: ExternalTransactionDataTable;
  import_sessions: ImportSessionsTable;
  transactions: TransactionsTable;
  wallet_addresses: WalletAddressesTable;
}

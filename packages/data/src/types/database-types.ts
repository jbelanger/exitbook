import type { Database as SQLiteDatabase } from 'sqlite3';

export type SQLParam = string | number | boolean | null | Buffer;

export interface SQLiteError extends Error {
  code: string;
  errno: number;
}

export interface DBQueryResult {
  changes?: number;
  lastID?: number;
}

export interface DatabaseResultRow {
  [key: string]: SQLParam;
}

export type DatabaseCallback<T> = (err: SQLiteError | null, result: T) => void;

export interface Database {
  db: SQLiteDatabase;
}

export interface DatabaseStats {
  totalExchanges: number;
  totalExternalTransactions: number;
  totalImportSessions: number;
  totalSnapshots: number;
  totalTransactions: number;
  totalVerifications: number;
  transactionsByExchange: Array<{
    count: number;
    exchange: string;
  }>;
}

export interface TransactionCountRow {
  count: number;
}

export interface StatRow {
  total_exchanges?: number;
  total_external_transactions?: number;
  total_import_sessions?: number;
  total_snapshots?: number;
  total_sources?: number;
  total_transactions?: number;
  total_verifications?: number;
}

export interface ImportSessionRow {
  completed_at?: number | null;
  created_at: number;
  duration_ms?: number | null;
  error_details?: string | null; // JSON string
  error_message?: string | null;
  id: number;
  provider_id?: string | null;
  session_metadata?: string | null; // JSON string
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  started_at: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  transactions_failed: number;
  transactions_imported: number;
  updated_at: number;
}

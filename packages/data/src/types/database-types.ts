import type { Database as SQLiteDatabase } from 'sqlite3';

export type SQLParam = string | number | boolean | undefined | Buffer;

export interface SQLiteError extends Error {
  code: string;
  errno: number;
}

export interface DBQueryResult {
  changes?: number;
  lastID?: number;
}

export type DatabaseResultRow = Record<string, SQLParam>;

export type DatabaseCallback<T> = (err: SQLiteError | undefined, result: T) => void;

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
  transactionsByExchange: {
    count: number;
    exchange: string;
  }[];
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
  completed_at?: number | undefined;
  created_at: number;
  duration_ms?: number | undefined;
  error_details?: string | undefined; // JSON string
  error_message?: string | undefined;
  id: number;
  provider_id?: string | undefined;
  session_metadata?: string | undefined; // JSON string
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  started_at: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  transactions_failed: number;
  transactions_imported: number;
  updated_at: number;
}

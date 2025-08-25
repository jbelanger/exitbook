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
  total_snapshots?: number;
  total_transactions?: number;
  total_verifications?: number;
}

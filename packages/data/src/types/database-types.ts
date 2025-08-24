import type { Database as SQLiteDatabase } from 'sqlite3';

export type SQLParam = string | number | boolean | null | Buffer;

export interface SQLiteError extends Error {
  code: string;
  errno: number;
}

export interface DBQueryResult {
  lastID?: number;
  changes?: number;
}

export interface DatabaseResultRow {
  [key: string]: SQLParam;
}

export type DatabaseCallback<T> = (err: SQLiteError | null, result: T) => void;

export interface Database {
  db: SQLiteDatabase;
}

export interface DatabaseStats {
  totalTransactions: number;
  totalExchanges: number;
  transactionsByExchange: Array<{
    exchange: string;
    count: number;
  }>;
  totalVerifications: number;
  totalSnapshots: number;
  totalRawTransactions: number;
}

export interface TransactionCountRow {
  count: number;
}

export interface StatRow {
  total_transactions?: number;
  total_exchanges?: number;
  total_verifications?: number;
  total_snapshots?: number;
  total_raw_transactions?: number;
}

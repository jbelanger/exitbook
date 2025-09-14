/**
 * Type definitions for KuCoin CSV data formats
 *
 * These types define the structure of CSV exports from KuCoin exchange
 * including spot orders, deposits/withdrawals, and account history.
 */

export interface CsvSpotOrderRow {
  'Account Type': string;
  'Avg. Filled Price': string;
  Fee: string;
  'Fee Currency': string;
  'Filled Amount': string;
  'Filled Time(UTC)': string;
  'Filled Volume': string;
  'Filled Volume (USDT)': string;
  'Order Amount': string;
  'Order ID': string;
  'Order Price': string;
  'Order Time(UTC)': string;
  'Order Type': string;
  Side: string;
  Status: string;
  Symbol: string;
  Tax?: string | undefined;
  UID: string;
}

export interface CsvDepositWithdrawalRow {
  'Account Type': string;
  Amount: string;
  Coin: string;
  'Deposit Address'?: string | undefined;
  Fee: string;
  Hash: string;
  Remarks: string;
  Status: string;
  'Time(UTC)': string;
  'Transfer Network': string;
  UID: string;
  'Withdrawal Address/Account'?: string | undefined;
}

export interface CsvAccountHistoryRow {
  'Account Type': string;
  Amount: string;
  Currency: string;
  Fee: string;
  Remark: string;
  Side: string;
  'Time(UTC)': string;
  Type: string;
  UID: string;
}

// Structured raw data type for better flow
export interface CsvKuCoinRawData {
  accountHistory: CsvAccountHistoryRow[];
  deposits: CsvDepositWithdrawalRow[];
  spotOrders: CsvSpotOrderRow[];
  withdrawals: CsvDepositWithdrawalRow[];
}

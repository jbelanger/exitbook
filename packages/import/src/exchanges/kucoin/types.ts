/**
 * Type definitions for KuCoin CSV data formats
 * 
 * These types define the structure of CSV exports from KuCoin exchange
 * including spot orders, deposits/withdrawals, and account history.
 */

export interface CsvSpotOrderRow {
  UID: string;
  "Account Type": string;
  "Order ID": string;
  "Order Time(UTC)": string;
  Symbol: string;
  Side: string;
  "Order Type": string;
  "Order Price": string;
  "Order Amount": string;
  "Avg. Filled Price": string;
  "Filled Amount": string;
  "Filled Volume": string;
  "Filled Volume (USDT)": string;
  "Filled Time(UTC)": string;
  Fee: string;
  "Fee Currency": string;
  Tax?: string;
  Status: string;
}

export interface CsvDepositWithdrawalRow {
  UID: string;
  "Account Type": string;
  "Time(UTC)": string;
  Coin: string;
  Amount: string;
  Fee: string;
  Hash: string;
  "Deposit Address"?: string;
  "Withdrawal Address/Account"?: string;
  "Transfer Network": string;
  Status: string;
  Remarks: string;
}

export interface CsvAccountHistoryRow {
  UID: string;
  "Account Type": string;
  Currency: string;
  Side: string;
  Amount: string;
  Fee: string;
  "Time(UTC)": string;
  Remark: string;
  Type: string;
}

// Structured raw data type for better flow
export interface CsvKuCoinRawData {
  spotOrders: CsvSpotOrderRow[];
  deposits: CsvDepositWithdrawalRow[];
  withdrawals: CsvDepositWithdrawalRow[];
  accountHistory: CsvAccountHistoryRow[];
}
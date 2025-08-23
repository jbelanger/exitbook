/**
 * Type definitions for Ledger Live CSV data formats
 * 
 * These types define the structure of CSV exports from Ledger Live
 * operation data.
 */

export interface CsvLedgerLiveOperationRow {
  "Operation Date": string;
  Status: string;
  "Currency Ticker": string;
  "Operation Type": string;
  "Operation Amount": string;
  "Operation Fees": string;
  "Operation Hash": string;
  "Account Name": string;
  "Account xpub": string;
  "Countervalue Ticker": string;
  "Countervalue at Operation Date": string;
  "Countervalue at CSV Export": string;
}
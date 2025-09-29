/**
 * Type definitions for Ledger Live CSV data formats
 *
 * These types define the structure of CSV exports from Ledger Live
 * operation data.
 */

export interface CsvLedgerLiveOperationRow {
  'Account Name': string;
  'Account xpub': string;
  'Countervalue at CSV Export': string;
  'Countervalue at Operation Date': string;
  'Countervalue Ticker': string;
  'Currency Ticker': string;
  'Operation Amount': string;
  'Operation Date': string;
  'Operation Fees': string;
  'Operation Hash': string;
  'Operation Type': string;
  Status: string;
}

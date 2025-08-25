/**
 * Constants for Ledger Live CSV data processing
 *
 * These constants define expected CSV headers and other configuration values
 * used for validating and processing Ledger Live operation data.
 */

/**
 * Expected CSV headers for different Ledger Live export types
 *
 * These headers are used to validate CSV files and ensure they contain
 * the expected data structure before processing.
 */
export const EXPECTED_HEADERS = {
  /**
   * Ledger Live operations CSV export header format
   * Contains cryptocurrency transaction history from Ledger Live wallets
   */
  LEDGERLIVE_CSV:
    'Operation Date,Status,Currency Ticker,Operation Type,Operation Amount,Operation Fees,Operation Hash,Account Name,Account xpub,Countervalue Ticker,Countervalue at Operation Date,Countervalue at CSV Export',
} as const;

/**
 * CSV file type mappings for header validation
 * Maps header strings to readable file type names
 */
export const CSV_FILE_TYPES = {
  [EXPECTED_HEADERS.LEDGERLIVE_CSV]: 'operations',
} as const;

/**
 * Type definitions for constants
 */
export type ExpectedHeaders = typeof EXPECTED_HEADERS;
export type CsvFileType = keyof typeof CSV_FILE_TYPES;

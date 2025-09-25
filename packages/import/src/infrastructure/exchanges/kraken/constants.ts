/**
 * Constants for Kraken CSV data processing
 *
 * These constants define expected CSV headers and other configuration values
 * used for validating and processing Kraken exchange data.
 */

/**
 * Expected CSV headers for different Kraken export types
 *
 * These headers are used to validate CSV files and ensure they contain
 * the expected data structure before processing.
 */
export const EXPECTED_HEADERS = {
  /**
   * Kraken ledger CSV export header format
   * Contains transaction history data including trades, deposits, withdrawals
   */
  LEDGERS_CSV: '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"',
} as const;

/**
 * CSV file type mappings for header validation
 * Maps header strings to readable file type names
 */
export const CSV_FILE_TYPES = {
  [EXPECTED_HEADERS.LEDGERS_CSV]: 'ledgers',
} as const;

/**
 * Type definitions for constants
 */
export type ExpectedHeaders = typeof EXPECTED_HEADERS;
export type CsvFileType = keyof typeof CSV_FILE_TYPES;

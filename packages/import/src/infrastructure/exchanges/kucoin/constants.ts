/**
 * Constants for KuCoin CSV data processing
 *
 * These constants define expected CSV headers and other configuration values
 * used for validating and processing KuCoin exchange data.
 */

/**
 * Expected CSV headers for different KuCoin export types
 *
 * These headers are used to validate CSV files and ensure they contain
 * the expected data structure before processing.
 */
export const EXPECTED_HEADERS = {
  /**
   * KuCoin account history CSV export header format
   * Contains balance changes, trades, deposits, withdrawals
   */
  ACCOUNT_HISTORY_CSV: 'UID,Account Type,Currency,Side,Amount,Fee,Time(UTC),Remark,Type',

  /**
   * KuCoin convert CSV export header format (Legacy - not actively used)
   * Contains currency conversion transactions
   */
  CONVERT_CSV: 'UID,Account Type,Payment Account,Sell,Buy,Price,Tax,Time of Update(UTC),Status',

  /**
   * KuCoin deposit CSV export header format
   * Contains cryptocurrency and fiat deposit transactions
   */
  DEPOSIT_CSV: 'UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Deposit Address,Transfer Network,Status,Remarks',

  /**
   * KuCoin order-splitting CSV export header format
   * Contains individual trade fills showing order execution details
   * Used for Spot, Margin, and Trading Bot orders
   */
  ORDER_SPLITTING_CSV:
    'UID,Account Type,Order ID,Symbol,Side,Order Type,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Tax,Maker/Taker,Fee Currency',

  /**
   * KuCoin trading/spot orders CSV export header format
   * Contains spot trading order history with fill details
   */
  TRADING_CSV:
    'UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Fee Currency,Tax,Status',

  /**
   * KuCoin withdrawal CSV export header format
   * Contains cryptocurrency and fiat withdrawal transactions
   */
  WITHDRAWAL_CSV:
    'UID,Account Type,Time(UTC),Coin,Amount,Fee,Hash,Withdrawal Address/Account,Transfer Network,Status,Remarks',
} as const;

/**
 * CSV file type mappings for header validation
 * Maps header strings to readable file type names
 */
export const CSV_FILE_TYPES = {
  [EXPECTED_HEADERS.ACCOUNT_HISTORY_CSV]: 'account_history',
  [EXPECTED_HEADERS.CONVERT_CSV]: 'convert',
  [EXPECTED_HEADERS.DEPOSIT_CSV]: 'deposit',
  [EXPECTED_HEADERS.ORDER_SPLITTING_CSV]: 'order_splitting',
  [EXPECTED_HEADERS.TRADING_CSV]: 'trading',
  [EXPECTED_HEADERS.WITHDRAWAL_CSV]: 'withdrawal',
} as const;

/**
 * Type definitions for constants
 */
export type ExpectedHeaders = typeof EXPECTED_HEADERS;
export type CsvFileType = keyof typeof CSV_FILE_TYPES;

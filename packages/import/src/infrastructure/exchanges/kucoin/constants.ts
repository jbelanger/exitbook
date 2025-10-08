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

  // ========================================
  // Known but not yet implemented file types
  // ========================================

  /**
   * Futures Orders - Filled Orders (Show Order-Splitting)
   * Not yet implemented - requires futures trading support
   */
  FUTURES_ORDER_SPLITTING_CSV:
    'UID,Account Type,Order ID,Filled Time(UTC),Symbol,Side,Filled Amount,Filled Price,Filled Volume,Filled Volume  (USDT),Fee Rate,Fee,Order Type',

  /**
   * Futures Orders - Realized PNL
   * Not yet implemented - requires futures trading support
   */
  FUTURES_REALIZED_PNL_CSV:
    'UID,Account Type,Symbol,Close Type,Realized PNL,Total Realized PNL,Total Funding Fees,Total Trading Fees,Position Opening Time(UTC),",Position Closing Time(UTC)"',

  /**
   * Margin Orders - Borrowings (Cross Margin)
   * Not yet implemented - requires margin trading support
   */
  MARGIN_BORROWINGS_CROSS_CSV:
    'UID,Account Type,Order ID,Coin,Amount,Interest,Repaid,Daily Interest,Term,Time Filled(UTC),Maturity Date(UTC),Repayment Time(UTC),Status',

  /**
   * Margin Orders - Borrowings (Isolated Margin)
   * Not yet implemented - requires margin trading support
   */
  MARGIN_BORROWINGS_ISOLATED_CSV:
    'UID,Account Type,Order ID,Coin,Amount,Interest,Repaid,Daily Interest,Term,Time Filled(UTC),Maturity Date(UTC),Repayment Time(UTC),Status',

  /**
   * Margin Orders - Filled Orders Show Order-Splitting (Cross Margin)
   * Not yet implemented - requires margin trading support
   */
  MARGIN_ORDER_SPLITTING_CROSS_CSV:
    'UID,Account Type,Order ID,Symbol,Side,Order Type,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,Tax,Maker/Taker,"Fee Currency,"',

  /**
   * Margin Orders - Filled Orders (Cross Margin)
   * Not yet implemented - requires margin trading support
   */
  MARGIN_ORDERS_CROSS_CSV:
    'UID,Account Type,Order ID,Order Time(UTC),Symbol,Side,Order Type,Order Price,Order Amount,Avg. Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Filled Time(UTC),Fee,"Fee Currency,",Tax,Status',

  /**
   * Margin Orders - Lendings
   * Not yet implemented - requires margin lending support
   */
  MARGIN_LENDINGS_CSV:
    'UID,Account Type,Order ID,Coin,Amount,Interest,User Repayment,Insurance Fund Repayment,Daily Interest,Term,Time Filled(UTC),Repayment Time(UTC),Status',

  /**
   * Fiat Orders - Fast Trade Orders
   * Not yet implemented - requires fiat trading support
   */
  FIAT_FAST_TRADE_CSV:
    'Order ID,Currency (Crypto),Crypto Quantity,Currency (Fiat),Fiat Amount,Fee Currency (Fiat),Fee (Fiat),Fee Currency (Crypto),Fee (Crypto),Channel,Payment Method,Status,Time(UTC)',

  /**
   * Fiat Orders - Fiat Deposits
   * Not yet implemented - requires fiat deposit support
   */
  FIAT_DEPOSITS_CSV: 'Order ID,Currency (Fiat),Fiat Amount,Fee,Deposit Method,Status,Time(UTC)',

  /**
   * Fiat Orders - Fiat Withdrawals
   * Not yet implemented - requires fiat withdrawal support
   */
  FIAT_WITHDRAWALS_CSV: 'Order ID,Currency (Fiat),Fiat Amount,Fee Currency,Fee,Withdrawal Method,Status,Time(UTC)',

  /**
   * Fiat Orders - P2P Orders
   * Not yet implemented - requires P2P trading support
   */
  FIAT_P2P_CSV:
    'Order ID,Currency (Fiat),Currency (Crypto),Side,Price,Crypto Quantity,Fiat Amount,Status,Tax,Time(UTC)',

  /**
   * Fiat Orders - Third-Party Payment
   * Not yet implemented - requires third-party payment support
   */
  FIAT_THIRD_PARTY_CSV:
    'Order ID,Order Type,Currency (Crypto),"Crypto Quantity,",Price,Currency (Fiat),Fiat Amount,Fee Currency,Fee,Status,Time(UTC)',

  /**
   * Earn Orders - Profit History
   * Not yet implemented - requires staking/earn support
   */
  EARN_PROFIT_CSV:
    'UID,Account Type,Order ID,Time(UTC),Staked Coin,Product Type,Product Name,Earnings Coin,Earnings Type,Remarks,Amount,Amount（USDT）,Fee',

  /**
   * Earn Orders - Staking History
   * Not yet implemented - requires staking/earn support
   */
  EARN_STAKING_CSV:
    'UID,Account Type,Staked Time(UTC),Staked Coin,Product Type,Product Name,Maturity Date(UTC),Amount,Redemption Time(UTC),Status',

  /**
   * Trading Bot - Filled Orders Show Order-Splitting (Futures)
   * Not yet implemented - requires trading bot support
   */
  TRADING_BOT_FUTURES_CSV:
    'UID,Account Type,Order ID,Time Filled(UTC),Symbol,Side,Order Type,Filled Amount,Filled Price,Filled Volume,Filled Volume (USDT),Fee,Fee Currency',

  /**
   * Trading Bot - Filled Orders Show Order-Splitting (Spot)
   * Shows individual fills for trading bot orders
   */
  TRADING_BOT_SPOT_CSV:
    'UID,Account Type,Order ID,Symbol,Side,Order Type,Filled Price,Filled Amount,Filled Volume,Filled Volume (USDT),Time Filled(UTC),Fee,Fee Currency,Tax',

  /**
   * Others - Asset Snapshots
   * Not yet implemented - informational only, not transaction data
   */
  ASSET_SNAPSHOTS_CSV: 'UID,Account Type,Account Name,Coin,Amount,Amount(USDT),Time(UTC)',
} as const;

/**
 * CSV file type mappings for header validation
 * Maps header strings to readable file type names
 */
export const CSV_FILE_TYPES = {
  // Implemented file types
  [EXPECTED_HEADERS.ACCOUNT_HISTORY_CSV]: 'account_history',
  [EXPECTED_HEADERS.CONVERT_CSV]: 'convert',
  [EXPECTED_HEADERS.DEPOSIT_CSV]: 'deposit',
  [EXPECTED_HEADERS.ORDER_SPLITTING_CSV]: 'order_splitting',
  [EXPECTED_HEADERS.TRADING_CSV]: 'trading',
  [EXPECTED_HEADERS.WITHDRAWAL_CSV]: 'withdrawal',

  // Known but not yet implemented file types
  [EXPECTED_HEADERS.FUTURES_ORDER_SPLITTING_CSV]: 'not_implemented_futures_orders',
  [EXPECTED_HEADERS.FUTURES_REALIZED_PNL_CSV]: 'not_implemented_futures_pnl',
  // Note: MARGIN_BORROWINGS_CROSS_CSV and MARGIN_BORROWINGS_ISOLATED_CSV have identical headers
  [EXPECTED_HEADERS.MARGIN_BORROWINGS_CROSS_CSV]: 'not_implemented_margin_borrowings',
  [EXPECTED_HEADERS.MARGIN_ORDER_SPLITTING_CROSS_CSV]: 'not_implemented_margin_orders',
  [EXPECTED_HEADERS.MARGIN_ORDERS_CROSS_CSV]: 'not_implemented_margin_orders',
  [EXPECTED_HEADERS.MARGIN_LENDINGS_CSV]: 'not_implemented_margin_lending',
  [EXPECTED_HEADERS.FIAT_FAST_TRADE_CSV]: 'not_implemented_fiat_trading',
  [EXPECTED_HEADERS.FIAT_DEPOSITS_CSV]: 'not_implemented_fiat_deposits',
  [EXPECTED_HEADERS.FIAT_WITHDRAWALS_CSV]: 'not_implemented_fiat_withdrawals',
  [EXPECTED_HEADERS.FIAT_P2P_CSV]: 'not_implemented_fiat_p2p',
  [EXPECTED_HEADERS.FIAT_THIRD_PARTY_CSV]: 'not_implemented_fiat_third_party',
  [EXPECTED_HEADERS.EARN_PROFIT_CSV]: 'not_implemented_earn_profit',
  [EXPECTED_HEADERS.EARN_STAKING_CSV]: 'not_implemented_earn_staking',
  [EXPECTED_HEADERS.TRADING_BOT_FUTURES_CSV]: 'not_implemented_trading_bot',
  [EXPECTED_HEADERS.TRADING_BOT_SPOT_CSV]: 'trading_bot',
  [EXPECTED_HEADERS.ASSET_SNAPSHOTS_CSV]: 'not_implemented_snapshots',
} as const;

/**
 * Type definitions for constants
 */
export type ExpectedHeaders = typeof EXPECTED_HEADERS;
export type CsvFileType = keyof typeof CSV_FILE_TYPES;

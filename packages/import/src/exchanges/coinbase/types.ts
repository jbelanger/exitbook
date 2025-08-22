/**
 * Type definitions for Coinbase Advanced Trade API
 * 
 * Based on: https://docs.cloud.coinbase.com/advanced-trade-api/docs/welcome
 * API Version: 2015-07-22
 * 
 * IMPORTANT: These are for the Advanced Trade API, not the deprecated Pro API.
 * Base URL: https://api.coinbase.com/api/v3/brokerage/
 * 
 * These types define the raw response structures from Coinbase's API before
 * any transformation to UniversalTransaction format.
 */

/**
 * Raw Coinbase account information from /api/v3/brokerage/accounts
 */
export interface RawCoinbaseAccount {
  /** Unique account identifier */
  uuid: string;
  /** Human-readable account name */
  name: string;
  /** Account currency (e.g., 'BTC', 'USD', 'CAD') */
  currency: string;
  /** Available balance for trading */
  available_balance: {
    value: string;
    currency: string;
  };
  /** Total balance including holds */
  hold?: {
    value: string;
    currency: string;
  };
  /** Whether this is the default account for this currency */
  default: boolean;
  /** Whether the account is active */
  active: boolean;
  /** Account type (e.g., 'wallet', 'trading') */
  type: string;
  /** Account creation date */
  created_at?: string;
  /** Account last update date */
  updated_at?: string;
  /** Account ready status */
  ready?: boolean;
}

/**
 * Raw ledger entry from /api/v3/brokerage/accounts/{account_id}/ledger
 * 
 * Each ledger entry represents a single balance change in an account.
 * For trades, multiple entries are created (e.g., one for each currency involved).
 */
export interface RawCoinbaseLedgerEntry {
  /** Unique ledger entry ID */
  id: string;
  /** ISO 8601 timestamp when the entry was created */
  created_at: string;
  /** Amount of the balance change */
  amount: {
    value: string;
    currency: string;
  };
  /** Balance after this entry was applied */
  balance?: {
    value: string;
    currency: string;
  };
  /** 
   * Type of ledger entry 
   * Common values: 'TRADE_FILL', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'FEE'
   */
  type: string;
  /** 
   * Direction of money flow from account perspective
   * 'DEBIT' = money going out, 'CREDIT' = money coming in
   */
  direction: 'DEBIT' | 'CREDIT';
  /** Additional details specific to the transaction type */
  details: RawCoinbaseLedgerDetails;
}

/**
 * Ledger entry details that vary by transaction type
 */
export interface RawCoinbaseLedgerDetails {
  /** Order ID for trade-related entries */
  order_id?: string;
  /** Trade/fill ID for executed orders */
  trade_id?: string;
  /** Product/trading pair ID (e.g., 'BTC-USD') */
  product_id?: string;
  /** Side of the order ('BUY' or 'SELL') */
  order_side?: 'BUY' | 'SELL';
  /** Fee associated with this entry */
  fee?: {
    value: string;
    currency: string;
  };
  /** Transfer ID for internal transfers */
  transfer_id?: string;
  /** Deposit/withdrawal method details */
  payment_method?: {
    id: string;
    type: string;
  };
  /** Cryptocurrency network for deposits/withdrawals */
  network?: string;
  /** Blockchain transaction hash */
  hash?: string;
  /** External address for crypto transfers */
  address?: string;
}

/**
 * Paginated response from ledger API
 */
export interface RawCoinbaseLedgerResponse {
  /** Array of ledger entries */
  ledger: RawCoinbaseLedgerEntry[];
  /** Pagination cursor for next page (if has_next is true) */
  cursor?: string;
  /** Whether there are more entries available */
  has_next: boolean;
}

/**
 * Response from /api/v3/brokerage/accounts endpoint
 */
export interface RawCoinbaseAccountsResponse {
  /** Array of user accounts */
  accounts: RawCoinbaseAccount[];
  /** Whether there are more accounts (pagination) */
  has_next?: boolean;
  /** Pagination cursor if has_next is true */
  cursor?: string;
  /** Total number of accounts */
  size?: number;
}

/**
 * API error response structure from Coinbase
 */
export interface CoinbaseAPIError {
  /** Error identifier */
  id: string;
  /** Error message */
  message: string;
  /** Additional error details */
  details?: any;
}

/**
 * Standard API response wrapper
 */
export interface CoinbaseAPIResponse<T> {
  /** Response data */
  data?: T;
  /** Error information if request failed */
  error?: CoinbaseAPIError;
  /** Request warnings */
  warnings?: string[];
}

/**
 * Authentication configuration for Coinbase API
 */
export interface CoinbaseCredentials {
  /** API key */
  apiKey: string;
  /** API secret for signing requests */
  secret: string;
  /** Passphrase associated with API key */
  passphrase: string;
  /** Whether to use sandbox environment */
  sandbox?: boolean;
}

/**
 * Request parameters for ledger endpoint
 */
export interface CoinbaseLedgerParams {
  /** Maximum number of entries to return (1-100) */
  limit?: number;
  /** Pagination cursor from previous response */
  cursor?: string;
  /** Start date filter (ISO 8601) */
  start_date?: string;
  /** End date filter (ISO 8601) */
  end_date?: string;
}

/**
 * Request parameters for accounts endpoint
 */
export interface CoinbaseAccountsParams {
  /** Maximum number of accounts to return */
  limit?: number;
  /** Pagination cursor from previous response */
  cursor?: string;
}
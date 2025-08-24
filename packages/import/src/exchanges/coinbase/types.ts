/**
 * Type definitions for Coinbase Track API
 *
 * Based on: https://docs.cdp.coinbase.com/coinbase-app/track-apis/
 * API Version: v2
 *
 * IMPORTANT: These are for the Track API, not the Advanced Trade API.
 * Base URL: https://api.coinbase.com/v2/
 *
 * These types define the raw response structures from Coinbase's Track API before
 * any transformation to UniversalTransaction format.
 */

/**
 * Raw Coinbase account information from /v2/accounts
 */
export interface RawCoinbaseAccount {
  /** Unique account identifier */
  id: string;
  /** Human-readable account name */
  name: string;
  /** Whether this is the primary account */
  primary: boolean;
  /** Account type (e.g., 'wallet', 'vault') */
  type: string;
  /** Account currency information */
  currency: {
    code: string;
    name: string;
    color: string;
    sort_index: number;
    exponent: number;
    type: string;
    address_regex?: string | undefined;
    asset_id?: string | undefined;
  };
  /** Current account balance */
  balance: {
    amount: string;
    currency: string;
  };
  /** Account creation date */
  created_at: string;
  /** Account last update date */
  updated_at: string;
  /** Resource type */
  resource: string;
  /** Resource path */
  resource_path: string;
  /** Whether deposits are allowed */
  allow_deposits?: boolean | undefined;
  /** Whether withdrawals are allowed */
  allow_withdrawals?: boolean | undefined;
}

/**
 * Raw transaction entry from /v2/accounts/:account_id/transactions
 * This is the primary transaction data source for Coinbase Track API
 */
export interface RawCoinbaseTransaction {
  /** Unique transaction identifier */
  id: string;
  /** Transaction type (e.g., 'send', 'request', 'transfer', 'buy', 'sell', 'trade', 'deposit', 'withdrawal') */
  type: string;
  /** Transaction status (e.g., 'pending', 'completed', 'canceled', 'failed') */
  status: string;
  /** Transaction amount */
  amount: {
    amount: string;
    currency: string;
  };
  /** Amount in user's native currency */
  native_amount: {
    amount: string;
    currency: string;
  };
  /** Transaction description */
  description: string;
  /** ISO 8601 timestamp when the transaction was created */
  created_at: string;
  /** ISO 8601 timestamp when the transaction was last updated */
  updated_at: string;
  /** Resource type */
  resource: string;
  /** Resource path */
  resource_path: string;
  /** Instant exchange information (for buy/sell transactions) */
  instant_exchange?:
    | {
        id: string;
        resource: string;
        resource_path: string;
      }
    | undefined;
  /** Buy information (for buy transactions) */
  buy?:
    | {
        id: string;
        resource: string;
        resource_path: string;
        fee?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        payment_method_name?: string | undefined;
        subtotal?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        total?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
      }
    | undefined;
  /** Sell information (for sell transactions) */
  sell?:
    | {
        id: string;
        resource: string;
        resource_path: string;
        fee?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        payment_method_name?: string | undefined;
        subtotal?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        total?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
      }
    | undefined;
  /** Trade information (for trade transactions) */
  trade?:
    | {
        id: string;
        resource: string;
        resource_path: string;
      }
    | undefined;
  /** Network information (for crypto transactions) */
  network?:
    | {
        status: string;
        status_description?: string | undefined;
        hash?: string | undefined;
        transaction_fee?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        transaction_amount?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        confirmations?: number | undefined;
      }
    | undefined;
  /** Recipient information (for send transactions) */
  to?:
    | {
        resource: string;
        address?: string | undefined;
        currency?: string | undefined;
        address_info?:
          | {
              address: string;
            }
          | undefined;
      }
    | undefined;
  /** Sender information */
  from?:
    | {
        resource: string;
        address?: string | undefined;
        currency?: string | undefined;
        address_info?:
          | {
              address: string;
            }
          | undefined;
      }
    | undefined;
  /** Additional transaction details */
  details?:
    | {
        title?: string | undefined;
        subtitle?: string | undefined;
        header?: string | undefined;
        health?: string | undefined;
      }
    | undefined;
  /** Hide from overview */
  hide?: boolean | undefined;
  /** Whether this transaction can be canceled */
  idem?: string | undefined;
}

/**
 * Raw ledger entry from /api/v3/brokerage/accounts/{account_id}/ledger
 * (DEPRECATED - this endpoint doesn't exist in Advanced Trade API)
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
  order_id?: string | undefined;
  /** Trade/fill ID for executed orders */
  trade_id?: string | undefined;
  /** Product/trading pair ID (e.g., 'BTC-USD') */
  product_id?: string | undefined;
  /** Side of the order ('BUY' or 'SELL') */
  order_side?: 'BUY' | 'SELL' | undefined;
  /** Fee associated with this entry */
  fee?:
    | {
        value: string;
        currency: string;
      }
    | undefined;
  /** Transfer ID for internal transfers */
  transfer_id?: string | undefined;
  /** Deposit/withdrawal method details */
  payment_method?:
    | {
        id: string;
        type: string;
      }
    | undefined;
  /** Cryptocurrency network for deposits/withdrawals */
  network?: string | undefined;
  /** Blockchain transaction hash */
  hash?: string | undefined;
  /** External address for crypto transfers */
  address?: string | undefined;
}

/**
 * Paginated response from transactions API
 */
export interface RawCoinbaseTransactionsResponse {
  /** Array of transaction entries */
  data: RawCoinbaseTransaction[];
  /** Pagination information */
  pagination?:
    | {
        ending_before?: string | undefined;
        starting_after?: string | undefined;
        previous_ending_before?: string | undefined;
        next_starting_after?: string | undefined;
        limit?: number | undefined;
        order?: string | undefined;
        previous_uri?: string | undefined;
        next_uri?: string | undefined;
      }
    | undefined;
}

/**
 * Paginated response from ledger API (DEPRECATED - endpoint doesn't exist)
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
 * Response from /v2/accounts endpoint
 */
export interface RawCoinbaseAccountsResponse {
  /** Array of user accounts */
  data: RawCoinbaseAccount[];
  /** Pagination information */
  pagination?:
    | {
        ending_before?: string | undefined;
        starting_after?: string | undefined;
        previous_ending_before?: string | undefined;
        next_starting_after?: string | undefined;
        limit?: number | undefined;
        order?: string | undefined;
        previous_uri?: string | undefined;
        next_uri?: string | undefined;
      }
    | undefined;
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
  details?: unknown;
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
  /** Passphrase associated with API key (not required for CDP keys) */
  passphrase?: string | undefined;
  /** Whether to use sandbox environment */
  sandbox?: boolean | undefined;
}

/**
 * Request parameters for transactions endpoint
 */
export interface CoinbaseTransactionsParams extends Record<string, unknown> {
  /** Filter by transaction type */
  type?: string | undefined;
  /** Maximum number of transactions to return (default 25, max 100) */
  limit?: number | undefined;
  /** Pagination - return transactions after this transaction ID */
  starting_after?: string | undefined;
  /** Pagination - return transactions before this transaction ID */
  ending_before?: string | undefined;
  /** Sort order (desc or asc, default desc) */
  order?: 'desc' | 'asc' | undefined;
  /** Expand parameter to include additional transaction types */
  expand?: string | undefined;
}

/**
 * Request parameters for ledger endpoint (deprecated - use fills instead)
 */
export interface CoinbaseLedgerParams extends Record<string, unknown> {
  /** Maximum number of entries to return (1-100) */
  limit?: number | undefined;
  /** Pagination cursor from previous response */
  cursor?: string | undefined;
  /** Start date filter (ISO 8601) */
  start_date?: string | undefined;
  /** End date filter (ISO 8601) */
  end_date?: string | undefined;
}

/**
 * Request parameters for accounts endpoint
 */
export interface CoinbaseAccountsParams extends Record<string, unknown> {
  /** Maximum number of accounts to return */
  limit?: number;
  /** Pagination cursor from previous response */
  cursor?: string;
  /** Include accounts with zero balances (experimental) */
  include_zero_balance?: boolean;
  /** Include all account states (experimental) */
  include_all?: boolean;
}

// CCXT-specific types for Coinbase adapter
export interface CcxtCoinbaseAdapterOptions {
  enableOnlineVerification?: boolean | undefined;
}

// CoinbaseAccount extends ccxt.Account and customizes some types for internal use (Decimal for balance)
export interface CcxtCoinbaseAccount {
  id: string;
  currency: string;
  balance: import('decimal.js').Decimal | number;
  type: string;
  code: string; // Required by ccxt.Account
  info: import('ccxt').Balance; // Required by ccxt.Account
  free?: number | undefined;
  used?: number | undefined;
  total?: number | undefined;
}

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
  /** Whether deposits are allowed */
  allow_deposits?: boolean | undefined;
  /** Whether withdrawals are allowed */
  allow_withdrawals?: boolean | undefined;
  /** Current account balance */
  balance: {
    amount: string;
    currency: string;
  };
  /** Account creation date */
  created_at: string;
  /** Account currency information */
  currency: {
    address_regex?: string | undefined;
    asset_id?: string | undefined;
    code: string;
    color: string;
    exponent: number;
    name: string;
    sort_index: number;
    type: string;
  };
  /** Unique account identifier */
  id: string;
  /** Human-readable account name */
  name: string;
  /** Whether this is the primary account */
  primary: boolean;
  /** Resource type */
  resource: string;
  /** Resource path */
  resource_path: string;
  /** Account type (e.g., 'wallet', 'vault') */
  type: string;
  /** Account last update date */
  updated_at: string;
}

/**
 * Raw transaction entry from /v2/accounts/:account_id/transactions
 * This is the primary transaction data source for Coinbase Track API
 */
export interface RawCoinbaseTransaction {
  /** Transaction amount */
  amount: {
    amount: string;
    currency: string;
  };
  /** Buy information (for buy transactions) */
  buy?:
    | {
        fee?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        id: string;
        payment_method_name?: string | undefined;
        resource: string;
        resource_path: string;
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
  /** ISO 8601 timestamp when the transaction was created */
  created_at: string;
  /** Transaction description */
  description: string;
  /** Additional transaction details */
  details?:
    | {
        header?: string | undefined;
        health?: string | undefined;
        subtitle?: string | undefined;
        title?: string | undefined;
      }
    | undefined;
  /** Sender information */
  from?:
    | {
        address?: string | undefined;
        address_info?:
          | {
              address: string;
            }
          | undefined;
        currency?: string | undefined;
        resource: string;
      }
    | undefined;
  /** Hide from overview */
  hide?: boolean | undefined;
  /** Unique transaction identifier */
  id: string;
  /** Whether this transaction can be canceled */
  idem?: string | undefined;
  /** Instant exchange information (for buy/sell transactions) */
  instant_exchange?:
    | {
        id: string;
        resource: string;
        resource_path: string;
      }
    | undefined;
  /** Amount in user's native currency */
  native_amount: {
    amount: string;
    currency: string;
  };
  /** Network information (for crypto transactions) */
  network?:
    | {
        confirmations?: number | undefined;
        hash?: string | undefined;
        status: string;
        status_description?: string | undefined;
        transaction_amount?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        transaction_fee?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
      }
    | undefined;
  /** Resource type */
  resource: string;
  /** Resource path */
  resource_path: string;
  /** Sell information (for sell transactions) */
  sell?:
    | {
        fee?:
          | {
              amount: string;
              currency: string;
            }
          | undefined;
        id: string;
        payment_method_name?: string | undefined;
        resource: string;
        resource_path: string;
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
  /** Transaction status (e.g., 'pending', 'completed', 'canceled', 'failed') */
  status: string;
  /** Recipient information (for send transactions) */
  to?:
    | {
        address?: string | undefined;
        address_info?:
          | {
              address: string;
            }
          | undefined;
        currency?: string | undefined;
        resource: string;
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
  /** Transaction type (e.g., 'send', 'request', 'transfer', 'buy', 'sell', 'trade', 'deposit', 'withdrawal') */
  type: string;
  /** ISO 8601 timestamp when the transaction was last updated */
  updated_at: string;
}

/**
 * Raw ledger entry from /api/v3/brokerage/accounts/{account_id}/ledger
 * (DEPRECATED - this endpoint doesn't exist in Advanced Trade API)
 *
 * Each ledger entry represents a single balance change in an account.
 * For trades, multiple entries are created (e.g., one for each currency involved).
 */
export interface RawCoinbaseLedgerEntry {
  /** Amount of the balance change */
  amount: {
    currency: string;
    value: string;
  };
  /** Balance after this entry was applied */
  balance?: {
    currency: string;
    value: string;
  };
  /** ISO 8601 timestamp when the entry was created */
  created_at: string;
  /** Additional details specific to the transaction type */
  details: RawCoinbaseLedgerDetails;
  /**
   * Direction of money flow from account perspective
   * 'DEBIT' = money going out, 'CREDIT' = money coming in
   */
  direction: 'DEBIT' | 'CREDIT';
  /** Unique ledger entry ID */
  id: string;
  /**
   * Type of ledger entry
   * Common values: 'TRADE_FILL', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'FEE'
   */
  type: string;
}

/**
 * Ledger entry details that vary by transaction type
 */
export interface RawCoinbaseLedgerDetails {
  /** External address for crypto transfers */
  address?: string | undefined;
  /** Fee associated with this entry */
  fee?:
    | {
        currency: string;
        value: string;
      }
    | undefined;
  /** Blockchain transaction hash */
  hash?: string | undefined;
  /** Cryptocurrency network for deposits/withdrawals */
  network?: string | undefined;
  /** Order ID for trade-related entries */
  order_id?: string | undefined;
  /** Side of the order ('BUY' or 'SELL') */
  order_side?: 'BUY' | 'SELL' | undefined;
  /** Deposit/withdrawal method details */
  payment_method?:
    | {
        id: string;
        type: string;
      }
    | undefined;
  /** Product/trading pair ID (e.g., 'BTC-USD') */
  product_id?: string | undefined;
  /** Trade/fill ID for executed orders */
  trade_id?: string | undefined;
  /** Transfer ID for internal transfers */
  transfer_id?: string | undefined;
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
        limit?: number | undefined;
        next_starting_after?: string | undefined;
        next_uri?: string | undefined;
        order?: string | undefined;
        previous_ending_before?: string | undefined;
        previous_uri?: string | undefined;
        starting_after?: string | undefined;
      }
    | undefined;
}

/**
 * Paginated response from ledger API (DEPRECATED - endpoint doesn't exist)
 */
export interface RawCoinbaseLedgerResponse {
  /** Pagination cursor for next page (if has_next is true) */
  cursor?: string;
  /** Whether there are more entries available */
  has_next: boolean;
  /** Array of ledger entries */
  ledger: RawCoinbaseLedgerEntry[];
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
        limit?: number | undefined;
        next_starting_after?: string | undefined;
        next_uri?: string | undefined;
        order?: string | undefined;
        previous_ending_before?: string | undefined;
        previous_uri?: string | undefined;
        starting_after?: string | undefined;
      }
    | undefined;
}

/**
 * API error response structure from Coinbase
 */
export interface CoinbaseAPIError {
  /** Additional error details */
  details?: unknown;
  /** Error identifier */
  id: string;
  /** Error message */
  message: string;
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
 * Request parameters for transactions endpoint
 */
export interface CoinbaseTransactionsParams extends Record<string, unknown> {
  /** Pagination - return transactions before this transaction ID */
  ending_before?: string | undefined;
  /** Expand parameter to include additional transaction types */
  expand?: string | undefined;
  /** Maximum number of transactions to return (default 25, max 100) */
  limit?: number | undefined;
  /** Sort order (desc or asc, default desc) */
  order?: 'desc' | 'asc' | undefined;
  /** Pagination - return transactions after this transaction ID */
  starting_after?: string | undefined;
  /** Filter by transaction type */
  type?: string | undefined;
}

/**
 * Request parameters for ledger endpoint (deprecated - use fills instead)
 */
export interface CoinbaseLedgerParams extends Record<string, unknown> {
  /** Pagination cursor from previous response */
  cursor?: string | undefined;
  /** End date filter (ISO 8601) */
  end_date?: string | undefined;
  /** Maximum number of entries to return (1-100) */
  limit?: number | undefined;
  /** Start date filter (ISO 8601) */
  start_date?: string | undefined;
}

/**
 * Request parameters for accounts endpoint
 */
export interface CoinbaseAccountsParams extends Record<string, unknown> {
  /** Pagination cursor from previous response */
  cursor?: string;
  /** Include all account states (experimental) */
  include_all?: boolean;
  /** Include accounts with zero balances (experimental) */
  include_zero_balance?: boolean;
  /** Maximum number of accounts to return */
  limit?: number;
}

// CCXT-specific types for Coinbase adapter
export interface CcxtCoinbaseAdapterOptions {
  enableOnlineVerification?: boolean | undefined;
}

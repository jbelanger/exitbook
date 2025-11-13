import type { Currency } from '@exitbook/core';

/**
 * Type definitions for Coinbase Consumer API v2
 *
 * Based on: https://developers.coinbase.com/api/v2
 *
 * These types define the raw response structures from Coinbase's Consumer API v2
 * as returned by CCXT's fetchLedger, before transformation to UniversalTransaction format.
 */

/**
 * Type-specific transaction details that vary by transaction type
 * Different types (advanced_trade_fill, buy, sell, send, trade, etc.) have different nested objects
 */
export interface RawCoinbaseTransactionDetails {
  /** Correlation ID - present in buy, sell, trade nested objects */
  id?: string | undefined;
  /** Order ID for advanced_trade_fill entries (groups multiple fills) */
  order_id?: string | undefined;
  /** Side of the order ('buy' or 'sell') */
  order_side?: string | undefined;
  /** Product/trading pair ID (e.g., 'BTC-USD') */
  product_id?: string | undefined;
  /** Trade/fill ID for executed orders */
  trade_id?: string | undefined;
  /** Commission/fee amount */
  commission?: string | undefined;
  /** Execution price */
  fill_price?: string | undefined;
  /** Payment method name for buy/sell transactions */
  payment_method_name?: string | undefined;
  /** Fee details for buy/sell transactions */
  fee?:
    | {
        amount: string;
        currency: Currency;
      }
    | undefined;
  /** Subtotal for buy/sell transactions */
  subtotal?:
    | {
        amount: string;
        currency: Currency;
      }
    | undefined;
  /** Total for buy/sell transactions */
  total?:
    | {
        amount: string;
        currency: Currency;
      }
    | undefined;
  /** Transfer ID for internal transfers */
  transfer_id?: string | undefined;
  /** External address for crypto transfers */
  address?: string | undefined;
  /** Blockchain transaction hash */
  hash?: string | undefined;
  /** Cryptocurrency network for deposits/withdrawals */
  network?: string | undefined;
  /** Deposit/withdrawal method details */
  payment_method?:
    | {
        id: string;
        type: string;
      }
    | undefined;
  /** Allow other fields we haven't explicitly defined */
  [key: string]: unknown;
}

/**
 * Raw transaction from Coinbase Consumer API v2
 *
 * Each transaction represents a balance change in an account.
 * Transaction types include: advanced_trade_fill, buy, sell, send, trade, fiat_deposit, fiat_withdrawal
 *
 * Structure:
 * - Top-level fields are common across all types
 * - Type-specific details are in a nested object named after the type
 */
export interface RawCoinbaseLedgerEntry {
  /** Unique transaction ID */
  id: string;
  /**
   * Type of transaction
   * Common values: 'advanced_trade_fill', 'buy', 'sell', 'send', 'trade', 'fiat_deposit', 'fiat_withdrawal'
   */
  type: string;
  /** ISO 8601 timestamp when the transaction was created */
  created_at: string;
  /** Transaction status */
  status: string;
  /** Amount of the balance change */
  amount: {
    amount: string; // Note: v2 API uses "amount" not "value"
    currency: Currency;
  };
  /** Native amount (usually USD equivalent) */
  native_amount?:
    | {
        amount: string;
        currency: Currency;
      }
    | undefined;

  /** Type-specific nested objects */
  advanced_trade_fill?: RawCoinbaseTransactionDetails | undefined;
  buy?: RawCoinbaseTransactionDetails | undefined;
  sell?: RawCoinbaseTransactionDetails | undefined;
  send?: RawCoinbaseTransactionDetails | undefined;
  trade?: RawCoinbaseTransactionDetails | undefined;

  /** Allow other type-specific fields */
  [key: string]: unknown;
}

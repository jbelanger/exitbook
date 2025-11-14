import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

/**
 * Coinbase API credentials schema
 */
export const CoinbaseCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  secret: z.string().min(1, 'Secret is required'),
});

export type CoinbaseCredentials = z.infer<typeof CoinbaseCredentialsSchema>;

/**
 * Coinbase ledger entry schema (from fetchLedger API via ccxt)
 * Captures all balance changes: trades, deposits, withdrawals, fees, etc.
 */
export const CoinbaseLedgerEntrySchema = z.object({
  id: z.string(), // Ledger entry ID
  direction: z.enum(['in', 'out']), // Direction of the transaction
  account: z.string().optional(), // Account ID
  referenceAccount: z.string().optional(), // Related account
  referenceId: z.string().optional(), // Reference to related transaction
  type: z.string(), // trade, transaction, fee, rebate, etc.
  currency: z.string(), // Asset currency code
  amount: DecimalStringSchema, // Amount (positive or negative)
  timestamp: z.number(), // Unix timestamp in milliseconds
  datetime: z.string(), // ISO8601 datetime string
  before: DecimalStringSchema.optional(), // Balance before
  after: DecimalStringSchema.optional(), // Balance after
  status: z.string().optional(), // pending, ok, canceled
  fee: z
    .object({
      currency: z.string(),
      cost: DecimalStringSchema,
    })
    .optional(),
});

/**
 * Schema for type-specific transaction details from Coinbase Consumer API v2
 * Different transaction types have different nested objects (advanced_trade_fill, buy, sell, send, trade, etc.)
 * This schema captures common fields that appear across different transaction types
 */
export const RawCoinbaseTransactionDetailsSchema = z
  .object({
    // Correlation ID - present in buy, sell, trade nested objects
    id: z.string().optional(),

    // Advanced trade fields
    order_id: z.string().optional(),
    order_side: z.string().optional(), // "buy", "sell"
    product_id: z.string().optional(), // e.g., "BTC-USD"
    trade_id: z.string().optional(),
    commission: z.string().optional(), // Fee amount
    fill_price: z.string().optional(), // Execution price

    // Buy/Sell transaction fields
    payment_method_name: z.string().optional(),
    fee: z
      .object({
        amount: z.string(),
        currency: z.string(),
      })
      .optional(),
    subtotal: z
      .object({
        amount: z.string(),
        currency: z.string(),
      })
      .optional(),
    total: z
      .object({
        amount: z.string(),
        currency: z.string(),
      })
      .optional(),

    // Transfer-related fields
    transfer_id: z.string().optional(),

    // Network-related fields (deposits/withdrawals)
    address: z.string().optional(),
    hash: z.string().optional(),
    network: z.string().optional(),

    // Payment method
    payment_method: z
      .object({
        id: z.string(),
        type: z.string(),
      })
      .optional(),
  })
  .passthrough(); // Allow other fields we haven't explicitly defined

/**
 * Schema for raw transaction from Coinbase Consumer API v2
 * Used to validate the structure in CCXT's info property for correlation ID extraction
 *
 * Structure: CCXT returns Coinbase v2 API transactions which have:
 * - Top-level fields: id, type, amount, created_at, status
 * - Type-specific nested object: advanced_trade_fill, buy, sell, send, trade, etc.
 */
export const RawCoinbaseLedgerEntrySchema = z
  .object({
    id: z.string(),
    type: z.string(),
    created_at: z.string(),
    status: z.string(),
    amount: z.object({
      amount: z.string(), // Note: v2 API uses "amount" not "value"
      currency: z.string(),
    }),
    native_amount: z
      .object({
        amount: z.string(),
        currency: z.string(),
      })
      .optional(),

    // Type-specific nested objects - use passthrough to allow any type-specific object
    // Common types: advanced_trade_fill, buy, sell, send, trade, fiat_deposit, fiat_withdrawal
    advanced_trade_fill: RawCoinbaseTransactionDetailsSchema.optional(),
    buy: RawCoinbaseTransactionDetailsSchema.optional(),
    sell: RawCoinbaseTransactionDetailsSchema.optional(),
    send: RawCoinbaseTransactionDetailsSchema.optional(),
    trade: RawCoinbaseTransactionDetailsSchema.optional(),

    // Allow other transaction type fields we haven't explicitly defined
  })
  .passthrough();

export type CoinbaseLedgerEntry = z.infer<typeof CoinbaseLedgerEntrySchema>;
export type RawCoinbaseTransactionDetails = z.infer<typeof RawCoinbaseTransactionDetailsSchema>;
export type RawCoinbaseLedgerEntry = z.infer<typeof RawCoinbaseLedgerEntrySchema>;

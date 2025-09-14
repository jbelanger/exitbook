/**
 * Zod validation schemas for Coinbase API data formats
 *
 * These schemas validate the structure and content of API responses from Coinbase
 * Track API (v2) before processing into UniversalTransaction format.
 */
import { z } from 'zod';

/**
 * Schema for money amounts in Coinbase API responses
 */
const CoinbaseMoneySchema = z
  .object({
    amount: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Amount must be a valid number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Amount must be parseable as number'),
    currency: z.string().min(1, 'Currency must not be empty'),
  })
  .strict();

/**
 * Schema for Coinbase account currency information
 */
const CoinbaseCurrencySchema = z
  .object({
    address_regex: z.string().optional(),
    asset_id: z.string().optional(),
    code: z.string().min(1, 'Currency code must not be empty'),
    color: z.string().min(1, 'Currency color must not be empty'),
    exponent: z.number().int().min(0, 'Currency exponent must be a non-negative integer'),
    name: z.string().min(1, 'Currency name must not be empty'),
    sort_index: z.number().int().min(0, 'Sort index must be a non-negative integer'),
    type: z.string().min(1, 'Currency type must not be empty'),
  })
  .strict();

/**
 * Schema for validating Coinbase account data
 */
export const RawCoinbaseAccountSchema = z
  .object({
    allow_deposits: z.boolean().optional(),
    allow_withdrawals: z.boolean().optional(),
    balance: CoinbaseMoneySchema,
    created_at: z
      .string()
      .min(1, 'Created at must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'Created at must be in ISO 8601 format'),
    currency: CoinbaseCurrencySchema,
    id: z.string().min(1, 'Account ID must not be empty'),
    name: z.string().min(1, 'Account name must not be empty'),
    primary: z.boolean(),
    resource: z.string().min(1, 'Resource must not be empty'),
    resource_path: z.string().min(1, 'Resource path must not be empty'),
    type: z
      .string()
      .min(1, 'Account type must not be empty')
      .refine(
        (val) => ['fiat', 'vault', 'wallet'].includes(val.toLowerCase()),
        'Account type must be wallet, vault, or fiat',
      ),
    updated_at: z
      .string()
      .min(1, 'Updated at must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'Updated at must be in ISO 8601 format'),
  })
  .strict();

/**
 * Schema for transaction buy/sell information
 */
const CoinbaseTradeInfoSchema = z
  .object({
    fee: CoinbaseMoneySchema.optional(),
    id: z.string().min(1, 'Trade ID must not be empty'),
    payment_method_name: z.string().optional(),
    resource: z.string().min(1, 'Trade resource must not be empty'),
    resource_path: z.string().min(1, 'Trade resource path must not be empty'),
    subtotal: CoinbaseMoneySchema.optional(),
    total: CoinbaseMoneySchema.optional(),
  })
  .strict();

/**
 * Schema for transaction details
 */
const CoinbaseTransactionDetailsSchema = z
  .object({
    header: z.string().optional(),
    health: z.string().optional(),
    subtitle: z.string().optional(),
    title: z.string().optional(),
  })
  .strict();

/**
 * Schema for transaction from/to information
 */
const CoinbaseTransactionPartySchema = z
  .object({
    address: z.string().optional(),
    address_info: z
      .object({
        address: z.string().min(1, 'Address info address must not be empty'),
      })
      .optional(),
    currency: z.string().optional(),
    resource: z.string().min(1, 'Party resource must not be empty'),
  })
  .strict();

/**
 * Schema for network information in transactions
 */
const CoinbaseNetworkSchema = z
  .object({
    confirmations: z.number().int().min(0, 'Confirmations must be non-negative').optional(),
    hash: z.string().optional(),
    status: z.string().min(1, 'Network status must not be empty'),
    status_description: z.string().optional(),
    transaction_amount: CoinbaseMoneySchema.optional(),
    transaction_fee: CoinbaseMoneySchema.optional(),
  })
  .strict();

/**
 * Schema for instant exchange information
 */
const CoinbaseInstantExchangeSchema = z
  .object({
    id: z.string().min(1, 'Instant exchange ID must not be empty'),
    resource: z.string().min(1, 'Instant exchange resource must not be empty'),
    resource_path: z.string().min(1, 'Instant exchange resource path must not be empty'),
  })
  .strict();

/**
 * Schema for trade information
 */
const CoinbaseTradeReferenceSchema = z
  .object({
    id: z.string().min(1, 'Trade ID must not be empty'),
    resource: z.string().min(1, 'Trade resource must not be empty'),
    resource_path: z.string().min(1, 'Trade resource path must not be empty'),
  })
  .strict();

/**
 * Schema for validating Coinbase transaction data
 */
export const RawCoinbaseTransactionSchema = z
  .object({
    amount: CoinbaseMoneySchema,
    buy: CoinbaseTradeInfoSchema.optional(),
    created_at: z
      .string()
      .min(1, 'Created at must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'Created at must be in ISO 8601 format'),
    description: z.string(), // Can be empty
    details: CoinbaseTransactionDetailsSchema.optional(),
    from: CoinbaseTransactionPartySchema.optional(),
    hide: z.boolean().optional(),
    id: z.string().min(1, 'Transaction ID must not be empty'),
    idem: z.string().optional(),
    instant_exchange: CoinbaseInstantExchangeSchema.optional(),
    native_amount: CoinbaseMoneySchema,
    network: CoinbaseNetworkSchema.optional(),
    resource: z.string().min(1, 'Resource must not be empty'),
    resource_path: z.string().min(1, 'Resource path must not be empty'),
    sell: CoinbaseTradeInfoSchema.optional(),
    status: z
      .string()
      .min(1, 'Status must not be empty')
      .refine(
        (val) =>
          [
            'canceled',
            'cancelled',
            'completed',
            'expired',
            'failed',
            'pending',
            'waiting_for_clearing',
            'waiting_for_signature',
          ].includes(val.toLowerCase()),
        'Status must be a valid Coinbase transaction status',
      ),
    to: CoinbaseTransactionPartySchema.optional(),
    trade: CoinbaseTradeReferenceSchema.optional(),
    type: z
      .string()
      .min(1, 'Type must not be empty')
      .refine(
        (val) =>
          [
            'buy',
            'exchange_deposit',
            'exchange_withdrawal',
            'fiat_deposit',
            'fiat_withdrawal',
            'pro_deposit',
            'pro_withdrawal',
            'request',
            'sell',
            'send',
            'trade',
            'transfer',
            'vault_withdrawal',
          ].includes(val.toLowerCase()),
        'Type must be a valid Coinbase transaction type',
      ),
    updated_at: z
      .string()
      .min(1, 'Updated at must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'Updated at must be in ISO 8601 format'),
  })
  .strict();

/**
 * Schema for paginated response wrapper
 */
const CoinbasePaginationSchema = z
  .object({
    ending_before: z.string().optional(),
    limit: z.number().int().min(1).optional(),
    next_starting_after: z.string().optional(),
    next_uri: z.string().optional(),
    order: z.string().optional(),
    previous_ending_before: z.string().optional(),
    previous_uri: z.string().optional(),
    starting_after: z.string().optional(),
  })
  .strict();

/**
 * Schema for validating Coinbase transactions API response
 */
export const RawCoinbaseTransactionsResponseSchema = z
  .object({
    data: z.array(RawCoinbaseTransactionSchema),
    pagination: CoinbasePaginationSchema.optional(),
  })
  .strict();

/**
 * Schema for validating Coinbase accounts API response
 */
export const RawCoinbaseAccountsResponseSchema = z
  .object({
    data: z.array(RawCoinbaseAccountSchema),
    pagination: CoinbasePaginationSchema.optional(),
  })
  .strict();

/**
 * Schema for API error responses
 */
export const CoinbaseAPIErrorSchema = z
  .object({
    details: z.any().optional(),
    id: z.string().min(1, 'Error ID must not be empty'),
    message: z.string().min(1, 'Error message must not be empty'),
  })
  .strict();

/**
 * Schema for standard API response wrapper
 */
export const CoinbaseAPIResponseSchema = z
  .object({
    data: z.any().optional(),
    error: CoinbaseAPIErrorSchema.optional(),
    warnings: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Legacy schemas for deprecated ledger API (kept for completeness)
 */
const CoinbaseLedgerDetailsSchema = z
  .object({
    address: z.string().optional(),
    fee: CoinbaseMoneySchema.optional(),
    hash: z.string().optional(),
    network: z.string().optional(),
    order_id: z.string().optional(),
    order_side: z.enum(['BUY', 'SELL']).optional(),
    payment_method: z
      .object({
        id: z.string().min(1, 'Payment method ID must not be empty'),
        type: z.string().min(1, 'Payment method type must not be empty'),
      })
      .optional(),
    product_id: z.string().optional(),
    trade_id: z.string().optional(),
    transfer_id: z.string().optional(),
  })
  .strict();

export const RawCoinbaseLedgerEntrySchema = z
  .object({
    amount: CoinbaseMoneySchema,
    balance: CoinbaseMoneySchema.optional(),
    created_at: z
      .string()
      .min(1, 'Created at must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'Created at must be in ISO 8601 format'),
    details: CoinbaseLedgerDetailsSchema,
    direction: z.enum(['DEBIT', 'CREDIT']),
    id: z.string().min(1, 'Ledger entry ID must not be empty'),
    type: z
      .string()
      .min(1, 'Ledger entry type must not be empty')
      .refine(
        (val) =>
          [
            'CONVERSION',
            'DEPOSIT',
            'FEE',
            'REBATE',
            'TRADE_FILL',
            'TRANSFER',
            'WITHDRAWAL',
          ].includes(val.toUpperCase()),
        'Ledger entry type must be a valid type',
      ),
  })
  .strict();

/**
 * Zod validation schemas for KuCoin CSV data formats
 *
 * These schemas validate the structure and content of CSV exports from KuCoin
 * exchange including spot orders, deposits/withdrawals, and account history.
 */
import { z } from 'zod';

/**
 * Schema for validating KuCoin CSV spot order row data
 */
export const CsvSpotOrderRowSchema = z
  .object({
    /** Account type (e.g., 'main', 'trade') */
    'Account Type': z.string().min(1, 'Account Type must not be empty'),

    /** Average filled price */
    'Avg. Filled Price': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Average Filled Price must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Average Filled Price must be parseable as number'),

    /** Trading fee */
    Fee: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Fee must be a valid number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Fee must be parseable as number'),

    /** Fee currency */
    'Fee Currency': z.string().min(1, 'Fee Currency must not be empty'),

    /** Amount that was filled */
    'Filled Amount': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Filled Amount must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Filled Amount must be parseable as number'),

    /** When the order was filled (UTC) */
    'Filled Time(UTC)': z
      .string()
      .min(1, 'Filled Time must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'Filled Time must be in YYYY-MM-DD HH:mm:ss format'),

    /** Volume of the filled order */
    'Filled Volume': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Filled Volume must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Filled Volume must be parseable as number'),

    /** Filled volume in USDT equivalent */
    'Filled Volume (USDT)': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Filled Volume (USDT) must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Filled Volume (USDT) must be parseable as number'),

    /** Original order amount */
    'Order Amount': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Order Amount must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Order Amount must be parseable as number'),

    /** Unique order identifier */
    'Order ID': z.string().min(1, 'Order ID must not be empty'),

    /** Order price */
    'Order Price': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Order Price must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Order Price must be parseable as number'),

    /** When the order was placed (UTC) */
    'Order Time(UTC)': z
      .string()
      .min(1, 'Order Time must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'Order Time must be in YYYY-MM-DD HH:mm:ss format'),

    /** Order type (e.g., 'limit', 'market') */
    'Order Type': z
      .string()
      .min(1, 'Order Type must not be empty')
      .refine(
        (val) => ['limit', 'market', 'stop', 'stop_limit'].includes(val.toLowerCase()),
        'Order Type must be a valid KuCoin order type'
      ),

    /** Buy or sell side */
    Side: z
      .string()
      .min(1, 'Side must not be empty')
      .refine((val) => ['buy', 'sell'].includes(val.toLowerCase()), 'Side must be either buy or sell'),

    /** Order status */
    Status: z
      .string()
      .min(1, 'Status must not be empty')
      .refine(
        (val) => ['cancel', 'cancelled', 'deal', 'done', 'filled', 'part_deal', 'partial'].includes(val.toLowerCase()),
        'Status must be a valid KuCoin order status'
      ),

    /** Trading pair symbol */
    Symbol: z.string().min(1, 'Symbol must not be empty'),

    /** Tax amount (optional field) */
    Tax: z
      .string()
      .refine((val) => val === '' || /^-?\d+(\.\d+)?$/.test(val), 'Tax must be a valid number format or empty string')
      .transform((val) => (val === '' ? undefined : val))
      .optional(),

    /** User ID */
    UID: z.string().min(1, 'UID must not be empty'),
  })
  .strict();

/**
 * Schema for validating KuCoin CSV deposit/withdrawal row data
 */
export const CsvDepositWithdrawalRowSchema = z
  .object({
    /** Account type */
    'Account Type': z.string().min(1, 'Account Type must not be empty'),

    /** Deposit/withdrawal amount */
    Amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Amount must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Amount must be parseable as number'),

    /** Cryptocurrency symbol */
    Coin: z.string().min(1, 'Coin must not be empty'),

    /** Deposit address (optional for withdrawals) */
    'Deposit Address': z.string().optional(),

    /** Transaction fee */
    Fee: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Fee must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Fee must be parseable as number'),

    /** Blockchain transaction hash */
    Hash: z.string(), // Can be empty for failed transactions

    /** Additional remarks */
    Remarks: z.string(),

    /** Transaction status */
    Status: z
      .string()
      .min(1, 'Status must not be empty')
      .refine(
        (val) =>
          ['failure', 'processing', 'success', 'wallet processing', 'wallet processing fail'].includes(
            val.toLowerCase()
          ),
        'Status must be a valid KuCoin transaction status'
      ),

    /** Transaction timestamp (UTC) */
    'Time(UTC)': z
      .string()
      .min(1, 'Time must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'Time must be in YYYY-MM-DD HH:mm:ss format'),

    /** Blockchain network */
    'Transfer Network': z.string().min(1, 'Transfer Network must not be empty'),

    /** User ID */
    UID: z.string().min(1, 'UID must not be empty'),

    /** Withdrawal address/account (optional for deposits) */
    'Withdrawal Address/Account': z.string().optional(),
  })
  .strict();

/**
 * Schema for validating KuCoin CSV account history row data
 */
export const CsvAccountHistoryRowSchema = z
  .object({
    /** Account type */
    'Account Type': z.string().min(1, 'Account Type must not be empty'),

    /** Transaction amount */
    Amount: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Amount must be a valid number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Amount must be parseable as number'),

    /** Currency symbol */
    Currency: z.string().min(1, 'Currency must not be empty'),

    /** Transaction fee */
    Fee: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Fee must be a valid number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Fee must be parseable as number'),

    /** Transaction remark/description */
    Remark: z.string(),

    /** Transaction side (credit/debit) */
    Side: z
      .string()
      .min(1, 'Side must not be empty')
      .refine(
        (val) => ['deposit', 'in', 'out', 'withdrawal'].includes(val.toLowerCase()),
        'Side must be Deposit, Withdrawal, in, or out'
      ),

    /** Transaction timestamp (UTC) */
    'Time(UTC)': z
      .string()
      .min(1, 'Time must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'Time must be in YYYY-MM-DD HH:mm:ss format'),

    /** Transaction type */
    Type: z
      .string()
      .min(1, 'Type must not be empty')
      .refine(
        (val) =>
          ['airdrop', 'deposit', 'rebate', 'reward', 'spot', 'trade', 'trading fee', 'transfer', 'withdrawal'].includes(
            val.toLowerCase()
          ),
        'Type must be a valid KuCoin account history type'
      ),

    /** User ID */
    UID: z.string().min(1, 'UID must not be empty'),
  })
  .strict();

/**
 * Schema for validating KuCoin CSV order-splitting (trade fills) row data
 * This format shows individual fills for orders, useful for detailed trade analysis
 */
export const CsvOrderSplittingRowSchema = z
  .object({
    /** User ID */
    UID: z.string().min(1, 'UID must not be empty'),

    /** Account type (e.g., 'main', 'trade') */
    'Account Type': z.string().min(1, 'Account Type must not be empty'),

    /** Unique order identifier */
    'Order ID': z.string().min(1, 'Order ID must not be empty'),

    /** Trading pair symbol */
    Symbol: z.string().min(1, 'Symbol must not be empty'),

    /** Buy or sell side */
    Side: z
      .string()
      .min(1, 'Side must not be empty')
      .refine((val) => ['buy', 'sell'].includes(val.toLowerCase()), 'Side must be either buy or sell'),

    /** Order type (e.g., 'limit', 'market') */
    'Order Type': z
      .string()
      .min(1, 'Order Type must not be empty')
      .refine(
        (val) => ['limit', 'market', 'stop', 'stop_limit'].includes(val.toLowerCase()),
        'Order Type must be a valid KuCoin order type'
      ),

    /** Price for this specific fill */
    'Avg. Filled Price': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Avg. Filled Price must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Avg. Filled Price must be parseable as number'),

    /** Amount that was filled in this transaction */
    'Filled Amount': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Filled Amount must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Filled Amount must be parseable as number'),

    /** Volume of the filled transaction */
    'Filled Volume': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Filled Volume must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Filled Volume must be parseable as number'),

    /** Filled volume in USDT equivalent */
    'Filled Volume (USDT)': z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Filled Volume (USDT) must be a valid positive number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Filled Volume (USDT) must be parseable as number'),

    /** When the fill occurred (UTC) */
    'Filled Time(UTC)': z
      .string()
      .min(1, 'Filled Time must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'Filled Time must be in YYYY-MM-DD HH:mm:ss format'),

    /** Trading fee for this fill */
    Fee: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Fee must be a valid number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Fee must be parseable as number'),

    /** Fee currency */
    'Fee Currency': z.string().min(1, 'Fee Currency must not be empty'),

    /** Tax amount (optional field) */
    Tax: z
      .string()
      .refine((val) => val === '' || /^-?\d+(\.\d+)?$/.test(val), 'Tax must be a valid number format or empty string')
      .transform((val) => (val === '' ? undefined : val))
      .optional(),

    /** Whether this fill was a maker or taker order */
    'Maker/Taker': z
      .string()
      .min(1, 'Maker/Taker must not be empty')
      .refine((val) => ['maker', 'taker'].includes(val.toLowerCase()), 'Maker/Taker must be either MAKER or TAKER'),
  })
  .strict();

/**
 * Schema for combined raw data from all KuCoin CSV sources
 */
export const CsvKuCoinRawDataSchema = z
  .object({
    accountHistory: z.array(CsvAccountHistoryRowSchema),
    deposits: z.array(CsvDepositWithdrawalRowSchema),
    orderSplitting: z.array(CsvOrderSplittingRowSchema),
    spotOrders: z.array(CsvSpotOrderRowSchema),
    withdrawals: z.array(CsvDepositWithdrawalRowSchema),
  })
  .strict();

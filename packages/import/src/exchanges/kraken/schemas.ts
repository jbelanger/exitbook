/**
 * Zod validation schemas for Kraken CSV data formats
 *
 * These schemas validate the structure and content of CSV exports from Kraken
 * exchange ledger data before processing.
 */
import { z } from 'zod';

/**
 * Schema for validating Kraken CSV ledger row data
 *
 * All fields are strings as they come from CSV parsing, but we validate
 * specific patterns and constraints where applicable.
 */
export const CsvKrakenLedgerRowSchema = z
  .object({
    /** Asset class (e.g., 'currency') */
    aclass: z.string().min(1, 'Asset class must not be empty'),

    /** Transaction amount (as string from CSV) */
    amount: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Amount must be a valid number format')
      .refine(val => !isNaN(parseFloat(val)), 'Amount must be parseable as number'),

    /** Asset/currency symbol (e.g., 'XETH', 'ZUSD', 'BTC') */
    asset: z.string().min(1, 'Asset must not be empty'),

    /** Account balance after transaction (as string from CSV) */
    balance: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Balance must be a valid number format')
      .refine(val => !isNaN(parseFloat(val)), 'Balance must be parseable as number'),

    /** Transaction fee (as string from CSV) */
    fee: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Fee must be a valid number format')
      .refine(val => !isNaN(parseFloat(val)), 'Fee must be parseable as number'),

    /** Reference ID for the transaction */
    refid: z.string(), // Can be empty for some transaction types

    /** Transaction subtype (e.g., 'spotfromfutures', '', etc.) */
    subtype: z.string(), // Optional field, can be empty

    /** Transaction timestamp (ISO 8601 format from Kraken) */
    time: z
      .string()
      .min(1, 'Time must not be empty')
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'Time must be in YYYY-MM-DD HH:mm:ss format'),

    /** Transaction ID */
    txid: z.string().min(1, 'Transaction ID must not be empty'),

    /** Transaction type (e.g., 'trade', 'deposit', 'withdrawal', 'transfer') */
    type: z
      .string()
      .min(1, 'Transaction type must not be empty')
      .refine(
        val =>
          [
            'trade',
            'deposit',
            'withdrawal',
            'transfer',
            'staking',
            'margin',
            'rollover',
            'credit',
            'debit',
            'adjustment',
          ].includes(val.toLowerCase()),
        'Transaction type must be a valid Kraken transaction type'
      ),

    /** Wallet type (e.g., 'spot', 'margin', 'futures') */
    wallet: z.string().min(1, 'Wallet must not be empty'),
  })
  .strict(); // Reject unknown properties

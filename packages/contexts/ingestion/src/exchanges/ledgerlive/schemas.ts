/**
 * Zod validation schemas for Ledger Live CSV data formats
 *
 * These schemas validate the structure and content of CSV exports from Ledger Live
 * operation data.
 */
import { z } from 'zod';

/**
 * Schema for validating Ledger Live CSV operation row data
 *
 * Ledger Live CSV exports contain operation data from various cryptocurrency
 * wallets managed through the Ledger Live application.
 */
export const CsvLedgerLiveOperationRowSchema = z
  .object({
    /** Name of the account (e.g., 'Bitcoin 1', 'Ethereum 1') */
    'Account Name': z.string().min(1, 'Account Name must not be empty'),

    /** Extended public key for the account */
    'Account xpub': z.string().min(1, 'Account xpub must not be empty'),

    /** Countervalue in fiat at time of CSV export */
    'Countervalue at CSV Export': z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Countervalue at CSV Export must be a valid number format')
      .refine(
        (val) => !isNaN(parseFloat(val)),
        'Countervalue at CSV Export must be parseable as number',
      ),

    /** Countervalue in fiat at time of operation */
    'Countervalue at Operation Date': z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Countervalue at Operation Date must be a valid number format')
      .refine(
        (val) => !isNaN(parseFloat(val)),
        'Countervalue at Operation Date must be parseable as number',
      ),

    /** Fiat currency ticker for countervalue (e.g., 'USD', 'EUR') */
    'Countervalue Ticker': z
      .string()
      .min(1, 'Countervalue Ticker must not be empty')
      .regex(/^[A-Z]{3}$/, 'Countervalue Ticker must be a valid 3-letter currency code'),

    /** Cryptocurrency ticker (e.g., 'BTC', 'ETH') */
    'Currency Ticker': z.string().min(1, 'Currency Ticker must not be empty'),

    /** Amount of the operation in the native cryptocurrency */
    'Operation Amount': z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'Operation Amount must be a valid number format')
      .refine((val) => !isNaN(parseFloat(val)), 'Operation Amount must be parseable as number'),

    /** Date and time of the operation (ISO 8601 format) */
    'Operation Date': z
      .string()
      .min(1, 'Operation Date must not be empty')
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/,
        'Operation Date must be in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)',
      ),

    /** Network fees paid for the operation */
    'Operation Fees': z
      .string()
      .transform((val) => (val === '' ? '0' : val)) // Convert empty strings to '0'
      .pipe(
        z
          .string()
          .regex(/^-?\d+(\.\d+)?$/, 'Operation Fees must be a valid number format')
          .refine((val) => !isNaN(parseFloat(val)), 'Operation Fees must be parseable as number'),
      ),

    /** Blockchain transaction hash */
    'Operation Hash': z.string(), // Can be empty for some operation types

    /** Type of operation */
    'Operation Type': z
      .string()
      .min(1, 'Operation Type must not be empty')
      .refine(
        (val) =>
          [
            'DELEGATE',
            'FEES',
            'IN',
            'NONE',
            'OPT_OUT',
            'OUT',
            'SELF',
            'STAKE',
            'UNDELEGATE',
            'WITHDRAW_UNBONDED',
          ].includes(val.toUpperCase()),
        'Operation Type must be one of: IN, OUT, SELF, FEES, NONE, STAKE, DELEGATE, UNDELEGATE, WITHDRAW_UNBONDED, OPT_OUT',
      ),

    /** Operation status */
    Status: z
      .string()
      .min(1, 'Status must not be empty')
      .refine(
        (val) =>
          ['confirmed', 'failed', 'pending', 'replaced', 'unconfirmed'].includes(val.toLowerCase()),
        'Status must be a valid Ledger Live operation status',
      ),
  })
  .strict(); // Reject unknown properties

import { z } from 'zod';

export const TransactionStatusSchema = z.enum(['pending', 'open', 'closed', 'canceled', 'failed', 'ok']);

/**
 * Zod schema for validating normalized exchange ledger entries.
 * This ensures all exchanges conform to the same strict contract after mapping.
 * Additional exchange-specific data should remain in raw_data, not in normalized data.
 */
export const ExchangeLedgerEntrySchema = z
  .object({
    /** Unique identifier for this ledger entry */
    id: z.string().min(1, 'Entry ID must not be empty'),

    /** Correlation ID that groups related entries (refid, referenceId, txid, etc.) */
    correlationId: z.string().min(1, 'Correlation ID must not be empty'),

    /** Unix timestamp in milliseconds (must be integer) */
    timestamp: z
      .number()
      .int()
      .positive('Timestamp must be a positive integer')
      .refine((val) => val > 946684800000, {
        message: 'Timestamp must be in milliseconds, not seconds (expected > year 2000 in ms)',
      }),

    /** Entry type (deposit, withdrawal, trade, fee, etc.) */
    type: z.string().min(1, 'Entry type must not be empty'),

    /** Asset symbol (BTC, USD, ETH, etc.) */
    asset: z.string().min(1, 'Asset must not be empty'),

    /** Amount as string (can be positive or negative) */
    amount: z.string(),

    /** Fee amount (optional) */
    fee: z.string().optional(),

    /** Fee currency (optional, defaults to asset if not specified) */
    feeCurrency: z.string().optional(),

    /** Entry status */
    status: TransactionStatusSchema,
  })
  .strict(); // Reject any additional fields not defined in schema

export type ExchangeLedgerEntry = z.infer<typeof ExchangeLedgerEntrySchema>;

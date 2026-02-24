import { CurrencySchema, TransactionStatusSchema } from '@exitbook/core';
import { z } from 'zod';

/**
 * Zod schema for validating normalized exchange ledger entries.
 * This is an ingestion-internal contract: processors build ExchangeLedgerEntry
 * from raw provider data before passing into grouping/interpretation strategies.
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
    assetSymbol: CurrencySchema,

    /** Amount as string (can be positive or negative) */
    amount: z.string(),

    /** Fee amount (optional) */
    fee: z.string().optional(),

    /** Fee currency (optional, defaults to asset if not specified) */
    feeCurrency: CurrencySchema.optional(),

    /** Entry status */
    status: TransactionStatusSchema,

    /** Blockchain transaction hash (for deposits/withdrawals) */
    hash: z.string().optional(),

    /** Blockchain address (for deposits/withdrawals) */
    address: z.string().optional(),

    /** Network/blockchain name (for deposits/withdrawals) */
    network: z.string().optional(),
  })
  .strict();

export type ExchangeLedgerEntry = z.infer<typeof ExchangeLedgerEntrySchema>;

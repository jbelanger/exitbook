import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

/**
 * KuCoin ledger entry schema (from fetchLedger API via ccxt)
 * Captures all balance changes: trades, deposits, withdrawals, fees, rebates, etc.
 */
export const KuCoinLedgerEntrySchema = z.object({
  id: z.string(), // Ledger entry ID
  direction: z.enum(['in', 'out']).optional(), // Direction of the transaction
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

export type KuCoinLedgerEntry = z.infer<typeof KuCoinLedgerEntrySchema>;

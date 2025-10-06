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
  amount: z.number(), // Amount (positive or negative)
  timestamp: z.number(), // Unix timestamp in milliseconds
  datetime: z.string(), // ISO8601 datetime string
  before: z.number().optional(), // Balance before
  after: z.number().optional(), // Balance after
  status: z.string().optional(), // pending, ok, canceled
  fee: z
    .object({
      currency: z.string(),
      cost: z.number(),
    })
    .optional(),
});

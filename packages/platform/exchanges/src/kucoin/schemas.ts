import { z } from 'zod';

/**
 * KuCoin API credentials schema
 */
export const KuCoinCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  secret: z.string().min(1, 'Secret is required'),
  passphrase: z.string().min(1, 'Passphrase is required'),
});

export type KuCoinCredentials = z.infer<typeof KuCoinCredentialsSchema>;

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

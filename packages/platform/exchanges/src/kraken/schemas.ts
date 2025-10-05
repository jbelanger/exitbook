import { z } from 'zod';

/**
 * Kraken API credentials schema
 */
export const KrakenCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  secret: z.string().min(1, 'Secret is required'),
});

export type KrakenCredentials = z.infer<typeof KrakenCredentialsSchema>;

/**
 * Kraken ledger entry schema (from fetchLedger API)
 * Types include: trade, deposit, withdrawal, spend, receive, etc.
 */
export const KrakenLedgerEntrySchema = z.object({
  id: z.string(), // Ledger ID (txid in CSV)
  refid: z.string(), // Reference ID (links related entries)
  time: z.coerce.number(), // Timestamp with decimals
  type: z.string(), // trade, deposit, withdrawal, spend, receive, etc.
  subtype: z.string().optional(), // e.g., "tradespot" for conversions
  aclass: z.string(), // Asset class (usually "currency")
  asset: z.string(), // Asset symbol
  amount: z.string(), // Amount as string (can be negative)
  fee: z.string(), // Fee as string
  balance: z.string(), // Running balance after this entry
});

export type KrakenLedgerEntry = z.infer<typeof KrakenLedgerEntrySchema>;

/**
 * Kraken transaction schema (ledger entry format)
 */
export const KrakenTransactionSchema = KrakenLedgerEntrySchema;

export type ParsedKrakenData = z.infer<typeof KrakenTransactionSchema>;

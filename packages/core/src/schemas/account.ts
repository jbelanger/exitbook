import { z } from 'zod';

import { CursorStateSchema } from './cursor.js';
import { VerificationMetadataSchema } from './import-session.ts';

/**
 * Account type schema - blockchain or exchange variants
 */
export const AccountTypeSchema = z.enum(['blockchain', 'exchange-api', 'exchange-csv']);

/**
 * Exchange credentials schema - generic key-value pairs validated per exchange
 */
export const ExchangeCredentialsSchema = z
  .object({
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
    apiPassphrase: z.string().optional(),
  })
  .strict();

/**
 * Account schema - persistent account metadata for exchanges and blockchains
 */
export const AccountSchema = z.object({
  id: z.number(),
  userId: z.number().optional(), // NULL for tracking-only accounts
  parentAccountId: z.number().optional(), // NULL for top-level accounts, set for derived address child accounts
  accountType: AccountTypeSchema,
  sourceName: z.string(), // 'kraken', 'bitcoin', 'ethereum', etc.
  identifier: z.string(), // address/xpub for blockchain, apiKey for exchange-api, CSV directory path for exchange-csv
  providerName: z.string().optional(), // preferred provider for blockchain imports
  credentials: ExchangeCredentialsSchema.optional(), // exchange-api credentials only
  lastCursor: z.record(z.string(), CursorStateSchema).optional(), // Record<operationType, CursorState>
  lastBalanceCheckAt: z.date().optional(),
  verificationMetadata: VerificationMetadataSchema.optional(),
  metadata: z
    .object({
      xpub: z
        .object({
          gapLimit: z.number(),
          lastDerivedAt: z.number(),
          derivedCount: z.number(),
        })
        .optional(),
    })
    .optional(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
});

/**
 * Type exports inferred from schemas
 */
export type AccountType = z.infer<typeof AccountTypeSchema>;
export type ExchangeCredentials = z.infer<typeof ExchangeCredentialsSchema>;
export type Account = z.infer<typeof AccountSchema>;

import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { NormalizedTransactionBaseSchema } from '../../core/schemas/normalized-transaction.js';

/**
 * XRP address schema with normalization
 * Addresses are case-sensitive base58 encoded starting with 'r'
 */
export const XrpAddressSchema = z
  .string()
  .min(1, 'Address must not be empty')
  .transform((val) => val.trim())
  .pipe(z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, 'Invalid XRP address format'));

/**
 * XRP currency amount (in drops)
 * 1 XRP = 1,000,000 drops
 * Represented as a string to avoid precision issues
 */
export const XrpDropsAmountSchema = z.string().regex(/^\d+$/, 'Amount must be a numeric string');

/**
 * Issued currency amount object
 * Used for tokens/IOUs on the XRP Ledger
 */
export const XrpIssuedCurrencyAmountSchema = z.object({
  currency: z.string().min(3).max(40),
  issuer: XrpAddressSchema,
  value: DecimalStringSchema,
});

/**
 * Amount can be either XRP (string) or an issued currency (object)
 */
export const XrpAmountSchema = z.union([XrpDropsAmountSchema, XrpIssuedCurrencyAmountSchema]);

/**
 * Balance change for an account
 * Extracted from transaction metadata
 */
export const XrpBalanceChangeSchema = z.object({
  account: XrpAddressSchema,
  balance: DecimalStringSchema,
  currency: z.string(),
  previousBalance: DecimalStringSchema.optional(),
});

/**
 * Schema for normalized XRP transaction
 *
 * Extends NormalizedTransactionBaseSchema to ensure consistent identity handling.
 * The eventId field is computed by providers during normalization using
 * generateUniqueTransactionEventId() with an XRP-specific scheme.
 */
export const XrpTransactionSchema = NormalizedTransactionBaseSchema.extend({
  // XRP-specific transaction data
  account: XrpAddressSchema,
  balanceChanges: z.array(XrpBalanceChangeSchema).optional(),
  currency: z.string(),
  destination: XrpAddressSchema.optional(),
  destinationTag: z.number().optional(),
  feeAmount: DecimalStringSchema,
  feeCurrency: z.literal('XRP'),
  ledgerIndex: z.number().positive(),
  providerName: z.string().min(1, 'Provider Name must not be empty'),
  sequence: z.number().nonnegative(),
  sourceTag: z.number().optional(),
  status: z.enum(['success', 'failed']),
  timestamp: z.number().positive('Timestamp must be positive'),
  transactionType: z.string(),
});

// Type exports inferred from schemas
export type XrpAddress = z.infer<typeof XrpAddressSchema>;
export type XrpDropsAmount = z.infer<typeof XrpDropsAmountSchema>;
export type XrpIssuedCurrencyAmount = z.infer<typeof XrpIssuedCurrencyAmountSchema>;
export type XrpAmount = z.infer<typeof XrpAmountSchema>;
export type XrpBalanceChange = z.infer<typeof XrpBalanceChangeSchema>;
export type XrpTransaction = z.infer<typeof XrpTransactionSchema>;

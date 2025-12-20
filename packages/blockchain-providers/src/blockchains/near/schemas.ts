/**
 * Zod validation schemas for NEAR transaction data formats
 *
 * These schemas validate the structure and content of transaction data
 * from different NEAR API providers before processing.
 */
import { DecimalStringSchema } from '@exitbook/core';
import { z } from 'zod';

import { NormalizedTransactionBaseSchema } from '../../core/schemas/normalized-transaction.js';

/**
 * NEAR address (account ID) schema with validation
 *
 * NEAR uses human-readable account IDs with specific format requirements:
 * - 2-64 characters long
 * - Contains only: lowercase letters (a-z), digits (0-9), underscores (_), hyphens (-)
 * - Must not have consecutive separators
 * - Implicit accounts (64 chars hex) and named accounts (.near, .testnet) are supported
 *
 * Examples:
 * - 'alice.near' (named account)
 * - 'token.sweat' (sub-account)
 * - '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de' (implicit account)
 */
export const NearAccountIdSchema = z
  .string()
  .min(2, 'NEAR account ID must be at least 2 characters')
  .max(64, 'NEAR account ID must not exceed 64 characters')
  .refine(
    (val) => {
      // Allow implicit accounts (64 character hex strings)
      if (/^[0-9a-f]{64}$/.test(val)) return true;
      // Validate named accounts
      return /^[a-z0-9_.-]+$/.test(val);
    },
    { message: 'NEAR account ID must contain only lowercase letters, digits, underscores, hyphens, and dots' }
  );

/**
 * Schema for NEAR action (part of a transaction)
 */
export const NearActionSchema = z.object({
  actionType: z.string().min(1, 'Action type must not be empty'),
  args: z.record(z.string(), z.unknown()).optional(),
  deposit: DecimalStringSchema.optional(),
  gas: DecimalStringSchema.optional(),
  methodName: z.string().optional(),
  publicKey: z.string().optional(),
  receiverId: NearAccountIdSchema.optional(),
});

/**
 * Schema for NEAR account balance change within a transaction
 */
export const NearAccountChangeSchema = z.object({
  account: NearAccountIdSchema,
  postBalance: DecimalStringSchema,
  preBalance: DecimalStringSchema,
});

/**
 * Schema for NEAR token transfer
 */
export const NearTokenTransferSchema = z.object({
  amount: DecimalStringSchema,
  contractAddress: NearAccountIdSchema,
  decimals: z.number().nonnegative(),
  from: NearAccountIdSchema,
  symbol: z.string().optional(),
  to: NearAccountIdSchema,
});

/**
 * Schema for normalized NEAR transaction
 *
 * Extends NormalizedTransactionBaseSchema to ensure consistent identity handling.
 * The eventId field is computed by providers during normalization using
 * generateUniqueTransactionEventId() with NEAR-specific discriminating fields
 * (e.g., receipt ID for FT transfers; action index / receipt ID if a single tx hash
 * is later expanded into multiple per-action/per-receipt events).
 */
export const NearTransactionSchema = NormalizedTransactionBaseSchema.extend({
  // NEAR-specific transaction data
  accountChanges: z.array(NearAccountChangeSchema).optional(),
  actions: z.array(NearActionSchema).optional(),
  amount: DecimalStringSchema,
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  currency: z.string().min(1, 'Currency must not be empty'),
  feeAmount: DecimalStringSchema.optional(),
  feeCurrency: z.string().optional(),
  from: NearAccountIdSchema,
  providerName: z.string().min(1, 'Provider name must not be empty'),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  to: NearAccountIdSchema,
  tokenTransfers: z.array(NearTokenTransferSchema).optional(),
  type: z.enum(['transfer', 'token_transfer', 'contract_call']),
});

// Type exports inferred from schemas (single source of truth)
export type NearAction = z.infer<typeof NearActionSchema>;
export type NearAccountChange = z.infer<typeof NearAccountChangeSchema>;
export type NearTokenTransfer = z.infer<typeof NearTokenTransferSchema>;
export type NearTransaction = z.infer<typeof NearTransactionSchema>;

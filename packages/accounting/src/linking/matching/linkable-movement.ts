import { CurrencySchema, DateSchema, DecimalSchema, SourceTypeSchema } from '@exitbook/core';
import { z } from 'zod';

/**
 * Ephemeral matching input built from processed transactions for linking strategies.
 */
export const LinkableMovementSchema = z.object({
  id: z.number(),
  transactionId: z.number(),
  accountId: z.number(),
  sourceName: z.string(),
  sourceType: SourceTypeSchema,
  assetId: z.string(),
  assetSymbol: CurrencySchema,
  direction: z.enum(['in', 'out']),
  amount: DecimalSchema,
  grossAmount: DecimalSchema.optional(),
  timestamp: DateSchema,
  blockchainTxHash: z.string().optional(),
  fromAddress: z.string().optional(),
  toAddress: z.string().optional(),
  isInternal: z.boolean(),
  excluded: z.boolean(),
  position: z.number().int().nonnegative(),
  movementFingerprint: z.string(),
});

export type LinkableMovement = z.infer<typeof LinkableMovementSchema>;

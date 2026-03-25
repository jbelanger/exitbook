import { SourceTypeSchema } from '@exitbook/core';
import { CurrencySchema, DateSchema, DecimalSchema } from '@exitbook/foundation';
import { z } from 'zod';

/**
 * Ephemeral matching input built from processed transactions for linking strategies.
 */
export const LinkableMovementSchema = z.object({
  id: z.number(),
  transactionId: z.number(),
  accountId: z.number(),
  platformKey: z.string(),
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
  movementFingerprint: z.string(),
});

export type LinkableMovement = z.infer<typeof LinkableMovementSchema>;

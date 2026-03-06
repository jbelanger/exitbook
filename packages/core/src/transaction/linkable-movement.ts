import { z } from 'zod';

import { SourceTypeSchema } from '../import-session/import-session.js';
import { CurrencySchema, DecimalSchema } from '../money/money.js';
import { DateSchema } from '../utils/primitives.js';

/**
 * A materialized, UTXO-collapsed, trade-excluded movement ready for linking strategies.
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
  utxoGroupId: z.string().optional(),
  excluded: z.boolean(),
});

/**
 * A linkable movement before persistence (no id yet).
 */
export const NewLinkableMovementSchema = LinkableMovementSchema.omit({ id: true });

export type LinkableMovement = z.infer<typeof LinkableMovementSchema>;
export type NewLinkableMovement = z.infer<typeof NewLinkableMovementSchema>;

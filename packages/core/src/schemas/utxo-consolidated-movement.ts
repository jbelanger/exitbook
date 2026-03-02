import { z } from 'zod';

import { CurrencySchema, DecimalSchema } from './money.js';
import { DateSchema } from './primitives.js';

/**
 * A consolidated UTXO movement that collapses multiple raw UTXO inputs/outputs
 * into a single logical movement per direction per transaction.
 */
export const UtxoConsolidatedMovementSchema = z.object({
  id: z.number(),
  transactionId: z.number(),
  accountId: z.number(),
  sourceName: z.string(),
  assetSymbol: CurrencySchema,
  direction: z.enum(['in', 'out']),
  amount: DecimalSchema,
  grossAmount: DecimalSchema.optional(),
  feeAmount: DecimalSchema.optional(),
  feeAssetSymbol: CurrencySchema.optional(),
  timestamp: DateSchema,
  blockchainTxHash: z.string(),
  fromAddress: z.string().optional(),
  toAddress: z.string().optional(),
  consolidatedFrom: z.array(z.number()).optional(),
  createdAt: DateSchema,
});

export const NewUtxoConsolidatedMovementSchema = UtxoConsolidatedMovementSchema.omit({ id: true, createdAt: true });

export type UtxoConsolidatedMovement = z.infer<typeof UtxoConsolidatedMovementSchema>;
export type NewUtxoConsolidatedMovement = z.infer<typeof NewUtxoConsolidatedMovementSchema>;

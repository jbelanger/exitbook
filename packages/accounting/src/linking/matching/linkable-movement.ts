import { PlatformKindSchema, TransactionDiagnosticSchema } from '@exitbook/core';
import { CurrencySchema, DateSchema, DecimalSchema } from '@exitbook/foundation';
import { TransactionAnnotationSchema, type TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { z } from 'zod';

/**
 * Ephemeral matching input built from processed transactions for linking strategies.
 */
export const LinkableMovementSchema = z.object({
  id: z.number(),
  transactionId: z.number(),
  accountId: z.number(),
  platformKey: z.string(),
  platformKind: PlatformKindSchema,
  assetId: z.string(),
  assetSymbol: CurrencySchema,
  direction: z.enum(['in', 'out']),
  amount: DecimalSchema,
  grossAmount: DecimalSchema.optional(),
  timestamp: DateSchema,
  blockchainTxHash: z.string().optional(),
  fromAddress: z.string().optional(),
  toAddress: z.string().optional(),
  transactionDiagnostics: z.array(TransactionDiagnosticSchema).optional(),
  transactionAnnotations: z.array(TransactionAnnotationSchema).optional(),
  isInternal: z.boolean(),
  excluded: z.boolean(),
  movementFingerprint: z.string(),
});

export type LinkableMovement = Omit<z.infer<typeof LinkableMovementSchema>, 'transactionAnnotations'> & {
  transactionAnnotations?: TransactionAnnotation[] | undefined;
};

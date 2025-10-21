import type z from 'zod';

import type {
  AssetMovementSchema,
  MovementDirectionSchema,
  PriceAtTxTimeSchema,
  TransactionNoteSchema,
  UniversalTransactionSchema,
} from '../schemas/universal-transaction.ts';

export type MovementDirection = z.infer<typeof MovementDirectionSchema>;

export type TransactionNote = z.infer<typeof TransactionNoteSchema>;
export type PriceAtTxTime = z.infer<typeof PriceAtTxTimeSchema>;
export type AssetMovement = z.infer<typeof AssetMovementSchema>;

export type UniversalTransaction = z.infer<typeof UniversalTransactionSchema>;

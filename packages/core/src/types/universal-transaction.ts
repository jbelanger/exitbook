import type z from 'zod';

import type {
  AssetMovementSchema,
  MovementDirectionSchema,
  OperationCategorySchema,
  OperationTypeSchema,
  PriceAtTxTimeSchema,
  TransactionNoteSchema,
  TransactionStatusSchema,
  UniversalTransactionSchema,
} from '../schemas/universal-transaction.ts';

export type MovementDirection = z.infer<typeof MovementDirectionSchema>;
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;
export type OperationCategory = z.infer<typeof OperationCategorySchema>;
export type OperationType = z.infer<typeof OperationTypeSchema>;

export type TransactionNote = z.infer<typeof TransactionNoteSchema>;
export type PriceAtTxTime = z.infer<typeof PriceAtTxTimeSchema>;
export type AssetMovement = z.infer<typeof AssetMovementSchema>;

export type UniversalTransaction = z.infer<typeof UniversalTransactionSchema>;

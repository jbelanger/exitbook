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
  FeeMovementSchema,
} from '../schemas/universal-transaction.ts';

export type MovementDirection = z.infer<typeof MovementDirectionSchema>;
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;
export type OperationCategory = z.infer<typeof OperationCategorySchema>;
export type OperationType = z.infer<typeof OperationTypeSchema>;

export type TransactionNote = z.infer<typeof TransactionNoteSchema>;
export type PriceAtTxTime = z.infer<typeof PriceAtTxTimeSchema>;
export type AssetMovement = z.infer<typeof AssetMovementSchema>;
export type FeeMovement = z.infer<typeof FeeMovementSchema>;

/**
 * Operation classification result with optional note
 * Used by transaction processors to classify operations
 */
export interface OperationClassification {
  operation: {
    category: OperationCategory;
    type: OperationType;
  };
  note?: TransactionNote | undefined;
}

/**
 * Input DTO for creating universal transaction records
 * Used by processors before persistence
 * Write-side
 */
export type UniversalTransaction = z.infer<typeof UniversalTransactionSchema>;

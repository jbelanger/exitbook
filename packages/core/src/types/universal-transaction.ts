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

/**
 * Input DTO for creating universal transaction records
 * Used by processors before persistence
 * Write-side
 */
export type UniversalTransaction = z.infer<typeof UniversalTransactionSchema>;

/**
 * Represents a universal transaction after saving to the database
 * Includes database-specific concerns (IDs, timestamps, source tracking)
 * Read-side
 */
export interface StoredTransaction extends Omit<UniversalTransaction, 'id'> {
  id: number;
  dataSourceId: number;
  sourceId: string;
  sourceType: 'exchange' | 'blockchain';
  createdAt: Date;
  updatedAt?: Date | undefined;
}

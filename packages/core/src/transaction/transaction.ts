import { z } from 'zod';

import { SourceTypeSchema } from '../import-session/import-session.js';

import {
  AssetMovementDraftSchema,
  FeeMovementDraftSchema,
  AssetMovementSchema,
  FeeMovementSchema,
} from './movement.js';

// Transaction status schema
export const TransactionStatusSchema = z.enum(['pending', 'open', 'closed', 'canceled', 'failed', 'success']);

// Operation category schema
export const OperationCategorySchema = z.enum(['trade', 'transfer', 'staking', 'defi', 'fee', 'governance']);

// Operation type schema
export const OperationTypeSchema = z.enum([
  'buy',
  'sell',
  'deposit',
  'withdrawal',
  'stake',
  'unstake',
  'reward',
  'swap',
  'fee',
  'batch',
  'transfer',
  'refund',
  'vote',
  'proposal',
  'airdrop',
]);

// Transaction note schema - allows additional properties for flexible metadata
export const TransactionNoteSchema = z.object({
  type: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Operation classification result with optional notes
 * Used by transaction processors to classify operations
 */
export interface OperationClassification {
  operation: {
    category: OperationCategory;
    type: OperationType;
  };
  notes?: TransactionNote[] | undefined;
}

export interface TransactionMaterializationScope {
  accountIds?: number[] | undefined;
  transactionIds?: number[] | undefined;
}

const hasAccountingImpact = (data: {
  fees?: unknown[] | undefined;
  movements: { inflows?: unknown[] | undefined; outflows?: unknown[] | undefined };
}): boolean => {
  const hasInflows = (data.movements.inflows?.length ?? 0) > 0;
  const hasOutflows = (data.movements.outflows?.length ?? 0) > 0;
  const hasFees = (data.fees?.length ?? 0) > 0;
  return hasInflows || hasOutflows || hasFees;
};

function createTransactionBaseFieldsSchema<TMovementSchema extends z.ZodTypeAny, TFeeSchema extends z.ZodTypeAny>(
  movementSchema: TMovementSchema,
  feeSchema: TFeeSchema
) {
  return z.object({
    datetime: z.string().min(1, 'Datetime string must not be empty'),
    timestamp: z.number().int().positive('Timestamp must be a positive integer'),
    source: z.string().min(1, 'Source must not be empty'),
    sourceType: SourceTypeSchema,
    status: TransactionStatusSchema,
    from: z.string().optional(),
    to: z.string().optional(),

    // Structured movements
    movements: z.object({
      inflows: z.array(movementSchema).default([]).optional(),
      outflows: z.array(movementSchema).default([]).optional(),
    }),

    // Structured fees
    fees: z.array(feeSchema).default([]),

    // Enhanced operation classification
    operation: z.object({
      category: OperationCategorySchema,
      type: OperationTypeSchema,
    }),

    // Blockchain metadata (optional - only for blockchain transactions)
    blockchain: z
      .object({
        name: z.string().min(1, 'Blockchain name must not be empty'),
        block_height: z.number().int().positive().optional(),
        transaction_hash: z.string().min(1, 'Transaction hash must not be empty'),
        is_confirmed: z.boolean(),
      })
      .optional(),

    // Optional fields
    notes: z.array(TransactionNoteSchema).optional(),

    // Spam detection
    isSpam: z.boolean().optional(),

    // Accounting exclusion
    excludedFromAccounting: z.boolean().optional(),
  });
}

// Base transaction fields shared by draft and persisted transactions.
const TransactionDraftBaseFieldsSchema = createTransactionBaseFieldsSchema(
  AssetMovementDraftSchema,
  FeeMovementDraftSchema
);
const TransactionBaseFieldsSchema = createTransactionBaseFieldsSchema(AssetMovementSchema, FeeMovementSchema);

// Pre-persistence transaction contract. Transient identity material is carried
// through the processing pipeline for fingerprint derivation but not persisted.
const TransactionDraftFieldsSchema = TransactionDraftBaseFieldsSchema.extend({
  identityMaterial: z
    .object({
      componentEventIds: z.array(z.string().min(1, 'Component event ID must not be empty')).min(1),
    })
    .optional(),
});

// Persisted transactions always carry their canonical txFingerprint.
const TransactionFieldsSchema = TransactionBaseFieldsSchema.extend({
  txFingerprint: z.string().min(1),
});

const accountingImpactValidation = {
  message:
    'Transaction must have at least one movement (inflow/outflow) or fee entry. ' +
    'Transactions with no accounting impact should not be stored.',
};

export const TransactionDraftSchema = TransactionDraftFieldsSchema.refine(
  (data) => hasAccountingImpact(data),
  accountingImpactValidation
).superRefine((transaction, ctx) => {
  if (transaction.sourceType === 'exchange' && transaction.identityMaterial === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Exchange transactions require identityMaterial.componentEventIds',
      path: ['identityMaterial'],
    });
  }

  if (transaction.sourceType === 'blockchain' && transaction.identityMaterial !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Blockchain transactions must not include identityMaterial',
      path: ['identityMaterial'],
    });
  }
});

// Transaction schema (full version with id and accountId)
// Used for database storage and retrieval
export const TransactionSchema = TransactionFieldsSchema.extend({
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
}).refine((data) => hasAccountingImpact(data), accountingImpactValidation);

export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;
export type OperationCategory = z.infer<typeof OperationCategorySchema>;
export type OperationType = z.infer<typeof OperationTypeSchema>;

export type TransactionNote = z.infer<typeof TransactionNoteSchema>;
export type TransactionDraft = z.infer<typeof TransactionDraftSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;

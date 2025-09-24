import { z } from 'zod';

// Custom Zod type for DecimalString (serialized Decimal.js values)
const DecimalStringSchema = z
  .string()
  .min(1, 'DecimalString must not be empty')
  .refine(
    (value) => {
      try {
        // Validate that string can be parsed as a valid Decimal
        const num = parseFloat(value);
        return !isNaN(num) && isFinite(num);
      } catch {
        return false;
      }
    },
    { message: 'DecimalString must be a valid numeric string' }
  );

// Enum schemas
export const MovementDirectionSchema = z.enum(['IN', 'OUT']);

export const MovementPurposeSchema = z.enum([
  'PRINCIPAL',
  'FEE',
  'GAS',
  'REWARD',
  'INTEREST',
  'COLLATERAL',
  'FUNDING_RATE',
  'OTHER',
]);

export const SourceTypeSchema = z.enum(['EXCHANGE', 'BLOCKCHAIN', 'CSV_IMPORT', 'MANUAL_ENTRY']);

export const TransactionEventTypeSchema = z.enum([
  'TRADE',
  'TRANSFER',
  'REWARD',
  'FEE_ONLY',
  'INTEREST',
  'BRIDGE',
  'LEND',
  'BORROW',
  'LIQUIDATION',
  'OTHER',
]);

export const OrderTypeSchema = z.enum(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT', 'TRAILING_STOP', 'OTHER']);

export const ValidationStatusSchema = z.enum(['VALID', 'WARNING', 'ERROR', 'PENDING']);

// Source details schemas (tagged union)

export const SourceDetailsSchema = z.object({
  chain: z.string().optional(), // blockchain network (bitcoin, ethereum, etc.)

  // Escape hatch for source-specific extras
  extras: z.record(z.string(), z.unknown()).optional(),
  kind: z.enum(['exchange', 'blockchain', 'other']),
  orderId: z.string().optional(), // Order/trade identifier for exchange sources
  txHash: z.string().optional(), // Transaction hash for blockchain sources

  // Common fields across all sources
  venue: z.string().optional(), // Exchange name, DEX protocol, etc.
});

// TransactionSource schema
export const TransactionSourceSchema = z.object({
  apiVersion: z.string().optional(),
  name: z.string().min(1, 'Source name must not be empty'),
  type: SourceTypeSchema,
});

// MovementMetadata schema
export const MovementMetadataSchema = z.object({
  // Account Context
  accountId: z.string().optional(),
  // Audit Trail
  blockHash: z.string().optional(),

  confirmations: z.number().int().min(0).optional(),
  executionPrice: DecimalStringSchema.optional(),

  fromAddress: z.string().optional(),
  gasPrice: DecimalStringSchema.optional(),
  // Network Context (for blockchain)
  gasUsed: z.number().int().min(0).optional(),
  // Transaction Context
  orderType: OrderTypeSchema.optional(),

  // Classification Hint (unified from movementHint)
  purposeHint: MovementPurposeSchema.optional(),
  toAddress: z.string().optional(),

  tradingPair: z.string().optional(),
  transactionHash: z.string().optional(),
  // Classification Context
  venue: z.string().optional(),
});

// Movement schema
export const MovementSchema = z.object({
  // Asset and Quantity
  currency: z.string().min(1, 'Currency must not be empty'),
  direction: MovementDirectionSchema,
  linkedMovementIds: z.array(z.string()).optional(),

  metadata: MovementMetadataSchema,
  // Classification Hints (for classifier)
  // Linking and Audit
  movementId: z.string().min(1, 'Movement ID must not be empty'),

  quantity: DecimalStringSchema,
});

// ProcessedTransaction schema
export const ProcessedTransactionSchema = z
  .object({
    blockNumber: z.number().int().positive().optional(),
    eventType: TransactionEventTypeSchema,
    // Identity and Source Tracking
    id: z.string().min(1, 'Transaction ID must not be empty'),
    // Financial Movements
    movements: z.array(MovementSchema).min(1, 'At least one movement is required'),

    // Audit and Linking
    originalData: z.record(z.string(), z.any()).optional(),
    // Processing Metadata
    processedAt: z.string().datetime(),
    processorVersion: z.string().min(1, 'Processor version must not be empty'),

    relatedTransactionIds: z.array(z.string()).optional(),

    source: TransactionSourceSchema,
    sourceDetails: SourceDetailsSchema,
    sourceUid: z.string().min(1, 'Source UID must not be empty'),

    // Timing and Context
    timestamp: z.string().datetime(),
    validationStatus: ValidationStatusSchema,
  })
  .strict()
  .refine(
    (data) => {
      // Validate that movement IDs are unique within the transaction
      const movementIds = data.movements.map((m) => m.movementId);
      return new Set(movementIds).size === movementIds.length;
    },
    {
      message: 'Movement IDs must be unique within a transaction',
      path: ['movements'],
    }
  )
  .refine(
    (data) => {
      // Validate zero-sum transfers for TRANSFER events
      if (data.eventType === 'TRANSFER') {
        const inMovements = data.movements.filter((m) => m.direction === 'IN');
        const outMovements = data.movements.filter((m) => m.direction === 'OUT');

        // For transfers, we should have both IN and OUT movements
        return inMovements.length > 0 && outMovements.length > 0;
      }
      return true;
    },
    {
      message: 'Transfer transactions must have both IN and OUT movements',
      path: ['movements'],
    }
  );

// AppliedRule schema
export const AppliedRuleSchema = z.object({
  confidence: z.number().min(0).max(1, 'Confidence must be between 0 and 1'),
  matched: z.boolean(),
  reasoning: z.string().min(1, 'Reasoning must not be empty'),
  ruleId: z.string().min(1, 'Rule ID must not be empty'),
  ruleName: z.string().min(1, 'Rule name must not be empty'),
});

// ManualOverride schema
export const ManualOverrideSchema = z.object({
  movementId: z.string().min(1, 'Movement ID must not be empty'),
  originalPurpose: MovementPurposeSchema,
  overrideBy: z.string().min(1, 'Override by must not be empty'),
  overridePurpose: MovementPurposeSchema,
  overrideReason: z.string().min(1, 'Override reason must not be empty'),
  overrideTimestamp: z.date(),
});

// ReprocessingEvent schema
export const ReprocessingEventSchema = z.object({
  newClassification: MovementPurposeSchema,
  previousClassification: MovementPurposeSchema,
  reprocessingId: z.string().min(1, 'Reprocessing ID must not be empty'),
  reprocessingReason: z.string().min(1, 'Reprocessing reason must not be empty'),
  reprocessingTimestamp: z.date(),
  ruleSetVersionAfter: z.string().min(1, 'Rule set version after must not be empty'),
  ruleSetVersionBefore: z.string().min(1, 'Rule set version before must not be empty'),
});

// ClassificationInfo schema
export const ClassificationInfoSchema = z.object({
  appliedRules: z.array(AppliedRuleSchema),
  lowConfidenceMovements: z.array(z.string()),

  // Audit Trail
  manualOverrides: z.array(ManualOverrideSchema).optional(),
  // Confidence Metrics
  overallConfidence: z.number().min(0).max(1, 'Overall confidence must be between 0 and 1'),

  reprocessingHistory: z.array(ReprocessingEventSchema).optional(),
  // Rule Tracking
  ruleSetVersion: z.string().min(1, 'Rule set version must not be empty'),
});

// ClassifiedMovement schema
export const ClassifiedMovementSchema = z.object({
  // Classification Metadata
  confidence: z.number().min(0).max(1, 'Confidence must be between 0 and 1'),

  // Original Movement
  movement: MovementSchema,

  // Assigned Purpose
  purpose: MovementPurposeSchema,
  reasoning: z.string().optional(),
  ruleId: z.string().min(1, 'Rule ID must not be empty'),
});

// ClassifiedTransaction schema
export const ClassifiedTransactionSchema = z
  .object({
    // Audit Information
    classificationInfo: ClassificationInfoSchema,

    // Classification Metadata
    classifiedAt: z.string().datetime(),

    classifierVersion: z.string().min(1, 'Classifier version must not be empty'),
    // Classifications
    movements: z.array(ClassifiedMovementSchema).min(1, 'At least one classified movement is required'),

    // Base Transaction
    processedTransaction: ProcessedTransactionSchema,
  })
  .strict()
  .refine(
    (data) => {
      // Validate that every ProcessedTransaction movement has a corresponding ClassifiedMovement
      const processedMovements = data.processedTransaction.movements.map((m) => m.movementId);
      const classifiedMovements = data.movements.map((cm) => cm.movement.movementId);

      return processedMovements.every((id) => classifiedMovements.includes(id));
    },
    {
      message: 'Every processed movement must have a corresponding classified movement',
      path: ['movements'],
    }
  );

// Type exports for use in other modules
export type ValidatedProcessedTransaction = z.infer<typeof ProcessedTransactionSchema>;
export type ValidatedClassifiedTransaction = z.infer<typeof ClassifiedTransactionSchema>;
export type ValidatedMovement = z.infer<typeof MovementSchema>;
export type ValidatedClassifiedMovement = z.infer<typeof ClassifiedMovementSchema>;
export type ValidatedTransactionSource = z.infer<typeof TransactionSourceSchema>;
export type ValidatedClassificationInfo = z.infer<typeof ClassificationInfoSchema>;

// Validation result types for error handling
export interface ValidationResult<T> {
  data?: T;
  errors?: z.ZodError;
  success: boolean;
}

// Helper functions to validate and return typed results
export function validateProcessedTransaction(data: unknown): ValidationResult<ValidatedProcessedTransaction> {
  const result = ProcessedTransactionSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

export function validateClassifiedTransaction(data: unknown): ValidationResult<ValidatedClassifiedTransaction> {
  const result = ClassifiedTransactionSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

export function validateMovement(data: unknown): ValidationResult<ValidatedMovement> {
  const result = MovementSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

// Batch validation helpers
export function validateProcessedTransactions(data: unknown[]): {
  invalid: { data: unknown; errors: z.ZodError }[];
  valid: ValidatedProcessedTransaction[];
} {
  const valid: ValidatedProcessedTransaction[] = [];
  const invalid: { data: unknown; errors: z.ZodError }[] = [];

  for (const item of data) {
    const result = validateProcessedTransaction(item);
    if (result.success && result.data) {
      valid.push(result.data);
    } else if (result.errors) {
      invalid.push({ data: item, errors: result.errors });
    }
  }

  return { invalid, valid };
}

export function validateClassifiedTransactions(data: unknown[]): {
  invalid: { data: unknown; errors: z.ZodError }[];
  valid: ValidatedClassifiedTransaction[];
} {
  const valid: ValidatedClassifiedTransaction[] = [];
  const invalid: { data: unknown; errors: z.ZodError }[] = [];

  for (const item of data) {
    const result = validateClassifiedTransaction(item);
    if (result.success && result.data) {
      valid.push(result.data);
    } else if (result.errors) {
      invalid.push({ data: item, errors: result.errors });
    }
  }

  return { invalid, valid };
}

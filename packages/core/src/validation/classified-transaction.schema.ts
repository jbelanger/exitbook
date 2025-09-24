import { z } from 'zod';

import {
  AppliedRuleSchema,
  ManualOverrideSchema,
  MovementPurposeSchema,
  MovementSchema,
  ProcessedTransactionSchema,
  ReprocessingEventSchema,
} from './processed-transaction.schema.js';

// Re-export core schemas for convenience
export {
  MovementPurposeSchema,
  AppliedRuleSchema,
  ManualOverrideSchema,
  ReprocessingEventSchema,
} from './processed-transaction.schema.js';

// ClassificationInfo schema
export const ClassificationInfoSchema = z
  .object({
    appliedRules: z.array(AppliedRuleSchema),
    lowConfidenceMovements: z.array(z.string()),

    // Audit Trail
    manualOverrides: z.array(ManualOverrideSchema).optional(),
    // Confidence Metrics
    overallConfidence: z.number().min(0).max(1, 'Overall confidence must be between 0 and 1'),

    reprocessingHistory: z.array(ReprocessingEventSchema).optional(),
    // Rule Tracking
    ruleSetVersion: z.string().min(1, 'Rule set version must not be empty'),
  })
  .strict()
  .refine(
    (_data) => {
      // Validate that low confidence movements reference valid movement IDs
      // This will be validated at the ClassifiedTransaction level
      return true;
    },
    {
      message: 'Low confidence movements must reference valid movement IDs',
    }
  );

// ClassifiedMovement schema
export const ClassifiedMovementSchema = z
  .object({
    // Classification Metadata
    confidence: z.number().min(0).max(1, 'Confidence must be between 0 and 1'),

    // Original Movement
    movement: MovementSchema,

    // Assigned Purpose
    purpose: MovementPurposeSchema,
    reasoning: z.string().optional(),
    ruleId: z.string().min(1, 'Rule ID must not be empty'),
  })
  .strict()
  .refine(
    (data) => {
      // Validate that confidence score aligns with movement purpose assignment
      // Very specific purposes should have high confidence
      const highConfidencePurposes = ['TRADING_FEE', 'GAS_FEE', 'NETWORK_FEE'];
      if (highConfidencePurposes.includes(data.purpose) && data.confidence < 0.8) {
        return false;
      }
      return true;
    },
    {
      message: 'Fee-related purposes should have high confidence scores (>= 0.8)',
      path: ['confidence'],
    }
  );

// ClassifiedTransaction schema
export const ClassifiedTransactionSchema = z
  .object({
    // Audit Information
    classificationInfo: ClassificationInfoSchema,

    // Classification Metadata
    classifiedAt: z.date(),

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

      return (
        processedMovements.every((id) => classifiedMovements.includes(id)) &&
        classifiedMovements.every((id) => processedMovements.includes(id))
      );
    },
    {
      message: 'Classified movements must exactly match processed movements',
      path: ['movements'],
    }
  )
  .refine(
    (data) => {
      // Validate that low confidence movements in ClassificationInfo reference valid movement IDs
      const movementIds = data.movements.map((cm) => cm.movement.movementId);
      return data.classificationInfo.lowConfidenceMovements.every((id) => movementIds.includes(id));
    },
    {
      message: 'Low confidence movement IDs must reference valid movements',
      path: ['classificationInfo', 'lowConfidenceMovements'],
    }
  )
  .refine(
    (data) => {
      // Validate that manual overrides reference valid movement IDs
      if (data.classificationInfo.manualOverrides) {
        const movementIds = data.movements.map((cm) => cm.movement.movementId);
        return data.classificationInfo.manualOverrides.every((override) => movementIds.includes(override.movementId));
      }
      return true;
    },
    {
      message: 'Manual override movement IDs must reference valid movements',
      path: ['classificationInfo', 'manualOverrides'],
    }
  )
  .refine(
    (data) => {
      // Validate that overall confidence is consistent with individual movement confidences
      const avgConfidence = data.movements.reduce((sum, m) => sum + m.confidence, 0) / data.movements.length;
      const tolerance = 0.1; // Allow 10% tolerance

      return Math.abs(data.classificationInfo.overallConfidence - avgConfidence) <= tolerance;
    },
    {
      message: 'Overall confidence should align with average movement confidence',
      path: ['classificationInfo', 'overallConfidence'],
    }
  )
  .refine(
    (data) => {
      // Validate that classifiedAt is after processedAt
      return data.classifiedAt >= data.processedTransaction.processedAt;
    },
    {
      message: 'Classification timestamp must be after or equal to processing timestamp',
      path: ['classifiedAt'],
    }
  );

// Type exports for use in other modules
export type ValidatedClassifiedTransaction = z.infer<typeof ClassifiedTransactionSchema>;
export type ValidatedClassifiedMovement = z.infer<typeof ClassifiedMovementSchema>;
export type ValidatedClassificationInfo = z.infer<typeof ClassificationInfoSchema>;

// Validation result types for error handling
export interface ValidationResult<T> {
  data?: T;
  errors?: z.ZodError;
  success: boolean;
}

// Helper functions to validate and return typed results
export function validateClassifiedTransaction(data: unknown): ValidationResult<ValidatedClassifiedTransaction> {
  const result = ClassifiedTransactionSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

export function validateClassifiedMovement(data: unknown): ValidationResult<ValidatedClassifiedMovement> {
  const result = ClassifiedMovementSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

export function validateClassificationInfo(data: unknown): ValidationResult<ValidatedClassificationInfo> {
  const result = ClassificationInfoSchema.safeParse(data);

  if (result.success) {
    return { data: result.data, success: true };
  }

  return { errors: result.error, success: false };
}

// Batch validation helpers
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

// Classification quality analysis helpers
export function analyzeClassificationQuality(transaction: ValidatedClassifiedTransaction): {
  issues: string[];
  overallQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  qualityScore: number;
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let qualityScore = 1.0;

  // Check overall confidence
  if (transaction.classificationInfo.overallConfidence < 0.7) {
    issues.push('Low overall confidence');
    qualityScore -= 0.3;
    recommendations.push('Review classification rules for this transaction type');
  }

  // Check for low confidence movements
  if (transaction.classificationInfo.lowConfidenceMovements.length > 0) {
    issues.push(`${transaction.classificationInfo.lowConfidenceMovements.length} movements with low confidence`);
    qualityScore -= 0.2;
    recommendations.push('Manual review recommended for low confidence movements');
  }

  // Check for manual overrides
  if (transaction.classificationInfo.manualOverrides && transaction.classificationInfo.manualOverrides.length > 0) {
    issues.push('Contains manual overrides');
    qualityScore -= 0.1;
    recommendations.push('Review rules to reduce need for manual intervention');
  }

  // Check for reprocessing history
  if (
    transaction.classificationInfo.reprocessingHistory &&
    transaction.classificationInfo.reprocessingHistory.length > 0
  ) {
    issues.push('Has been reprocessed');
    qualityScore -= 0.1;
    recommendations.push('Validate rule stability to reduce reprocessing');
  }

  // Determine overall quality
  let overallQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  if (qualityScore >= 0.8) {
    overallQuality = 'HIGH';
  } else if (qualityScore >= 0.6) {
    overallQuality = 'MEDIUM';
  } else {
    overallQuality = 'LOW';
  }

  return {
    issues,
    overallQuality,
    qualityScore,
    recommendations,
  };
}

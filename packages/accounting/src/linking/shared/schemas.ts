import {
  DecimalSchema,
  LinkStatusSchema,
  LinkTypeSchema,
  MatchCriteriaSchema,
  NewTransactionLinkSchema,
  SameHashExternalSourceAllocationSchema,
  TransactionLinkMetadataSchema,
  TransactionLinkScoreBreakdownEntrySchema,
  TransactionLinkSchema,
} from '@exitbook/core';
import { z } from 'zod';

import { LinkableMovementSchema } from '../matching/linkable-movement.js';

const UnitIntervalDecimalSchema = DecimalSchema.refine(
  (value) => value.greaterThanOrEqualTo(0) && value.lessThanOrEqualTo(1),
  { message: 'Value must be between 0 and 1 (inclusive)' }
);

/**
 * Shared transaction link schemas re-exported for accounting APIs
 */
export {
  LinkableMovementSchema,
  LinkTypeSchema,
  LinkStatusSchema,
  MatchCriteriaSchema,
  NewTransactionLinkSchema,
  SameHashExternalSourceAllocationSchema,
  TransactionLinkMetadataSchema,
  TransactionLinkScoreBreakdownEntrySchema,
  TransactionLinkSchema,
};

/**
 * A single component of a confidence score breakdown.
 * Captures which signal contributed, its weight, raw value, and weighted contribution.
 */
export const ScoreComponentSchema = z.object({
  signal: z.string(),
  weight: DecimalSchema,
  value: DecimalSchema,
  contribution: DecimalSchema,
});

/**
 * Potential match schema
 */
export const PotentialMatchSchema = z.object({
  sourceMovement: LinkableMovementSchema,
  targetMovement: LinkableMovementSchema,
  confidenceScore: UnitIntervalDecimalSchema,
  matchCriteria: MatchCriteriaSchema,
  linkType: LinkTypeSchema,
  consumedAmount: DecimalSchema.optional(),
  scoreBreakdown: z.array(ScoreComponentSchema).optional(),
});

/**
 * Matching config schema
 */
export const MatchingConfigSchema = z.object({
  maxTimingWindowHours: z.number().positive(),
  clockSkewToleranceHours: z.number().nonnegative().default(2),
  minConfidenceScore: DecimalSchema,
  autoConfirmThreshold: DecimalSchema,
  minPartialMatchFraction: DecimalSchema,
});

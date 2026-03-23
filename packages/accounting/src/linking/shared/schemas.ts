import { LinkTypeSchema, MatchCriteriaSchema, UnitIntervalDecimalSchema } from '@exitbook/core';
import { DecimalSchema } from '@exitbook/foundation';
import { z } from 'zod';

import { LinkableMovementSchema } from '../matching/linkable-movement.js';

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

import type { z } from 'zod';

import type { MatchingConfigSchema, PotentialMatchSchema, ScoreComponentSchema } from './schemas.js';

/**
 * Types inferred from Zod schemas - schemas are the source of truth
 * This ensures runtime validation and compile-time types stay in sync
 */

/**
 * A single component of a confidence score breakdown
 */
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;

/**
 * A potential match found by the matching algorithm
 */
export type PotentialMatch = z.infer<typeof PotentialMatchSchema>;

/**
 * Configuration for the matching algorithm
 * - maxTimingWindowHours: Maximum time window between source and target (default: 48 hours)
 * - minConfidenceScore: Minimum confidence score to suggest a match 0-1 (default: 0.7)
 * - autoConfirmThreshold: Automatically confirm matches above this confidence 0-1 (default: 0.95 = 95% confident)
 * - minPartialMatchFraction: Minimum fraction of the larger amount consumed by a partial match (default: 0.1)
 */
export type MatchingConfig = z.infer<typeof MatchingConfigSchema>;

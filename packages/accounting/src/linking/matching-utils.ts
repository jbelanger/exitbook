import { parseDecimal } from '@exitbook/core';

import type { MatchingConfig } from './types.js';

// Re-export all stage modules
export {
  aggregateMovementsByTransaction,
  calculateOutflowAdjustment,
  convertToCandidates,
  separateSourcesAndTargets,
} from './candidate-preparation.js';

export {
  buildMatchCriteria,
  calculateAmountSimilarity,
  calculateConfidenceScore,
  calculateTimeDifferenceHours,
  checkAddressMatch,
  checkTransactionHashMatch,
  determineLinkType,
  isTimingValid,
  normalizeTransactionHash,
  scoreAndFilterMatches,
} from './candidate-scoring.js';

export { allocateMatches, shouldAutoConfirm } from './match-allocation.js';

export {
  calculateVarianceMetadata,
  createTransactionLink,
  MAX_HASH_MATCH_TARGET_EXCESS_PCT,
  validateLinkAmounts,
  validateLinkAmountsForMatch,
} from './link-construction.js';
export type { LinkAmountValidationInfo } from './link-construction.js';

// Backward-compatible aliases for renamed functions
export { scoreAndFilterMatches as findPotentialMatches } from './candidate-scoring.js';
export { allocateMatches as deduplicateAndConfirm } from './match-allocation.js';

/**
 * Default matching configuration
 */
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  maxTimingWindowHours: 48,
  clockSkewToleranceHours: 2,
  minAmountSimilarity: parseDecimal('0.95'),
  minConfidenceScore: parseDecimal('0.7'),
  autoConfirmThreshold: parseDecimal('0.95'),
};

/**
 * Build a matching config by merging overrides into defaults.
 *
 * @param overrides - Partial config to merge
 * @returns Complete matching configuration
 */
export function buildMatchingConfig(overrides?: Partial<MatchingConfig>): MatchingConfig {
  return { ...DEFAULT_MATCHING_CONFIG, ...overrides };
}

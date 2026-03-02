import { parseDecimal } from '@exitbook/core';

import type { MatchingConfig } from './types.js';

/**
 * Default matching configuration
 */
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  maxTimingWindowHours: 48,
  clockSkewToleranceHours: 2,
  minConfidenceScore: parseDecimal('0.7'),
  autoConfirmThreshold: parseDecimal('0.95'),
  minPartialMatchFraction: parseDecimal('0.1'),
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

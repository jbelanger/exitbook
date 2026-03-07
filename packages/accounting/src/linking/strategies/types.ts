import type { Result } from '@exitbook/core';

import type { LinkCandidate } from '../pre-linking/types.js';
import type { MatchingConfig, NewTransactionLink } from '../types.js';

/**
 * Result of running a single linking strategy.
 */
export interface StrategyResult {
  /** Links produced by this strategy */
  links: NewTransactionLink[];
  /** IDs of candidates consumed (claimed) by this strategy */
  consumedCandidateIds: Set<number>;
}

/**
 * A strategy that matches source candidates (outflows) to target candidates (inflows).
 * Strategies run in order on a shrinking pool of unclaimed candidates.
 */
export interface ILinkingStrategy {
  readonly name: string;

  execute(sources: LinkCandidate[], targets: LinkCandidate[], config: MatchingConfig): Result<StrategyResult, Error>;
}

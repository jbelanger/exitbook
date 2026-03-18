import type { NewTransactionLink, Result } from '@exitbook/core';

import type { LinkableMovement } from '../pre-linking/types.js';
import type { MatchingConfig } from '../shared/types.js';

/**
 * Result of running a single linking strategy.
 */
export interface StrategyResult {
  /** Links produced by this strategy */
  links: NewTransactionLink[];
  /** IDs of linkable movements consumed (claimed) by this strategy */
  consumedCandidateIds: Set<number>;
}

/**
 * A strategy that matches source movements (outflows) to target movements (inflows).
 * Strategies run in order on a shrinking pool of unclaimed linkable movements.
 */
export interface ILinkingStrategy {
  readonly name: string;

  execute(
    sources: LinkableMovement[],
    targets: LinkableMovement[],
    config: MatchingConfig
  ): Result<StrategyResult, Error>;
}

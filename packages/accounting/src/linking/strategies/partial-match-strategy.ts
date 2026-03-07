import { parseDecimal } from '@exitbook/core';
import { ok, type Result } from '@exitbook/core';

import { createTransactionLink } from '../link-construction.js';
import { allocateMatches } from '../match-allocation.js';
import type { LinkCandidate } from '../pre-linking/types.js';
import type { MatchingConfig, NewTransactionLink, PotentialMatch } from '../types.js';

import { scoreAndFilterMatches } from './amount-timing-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

/**
 * Runs on remaining pool with relaxed thresholds to catch 1:N / N:1 patterns.
 * All links produced are 'suggested' status.
 */
export class PartialMatchStrategy implements ILinkingStrategy {
  readonly name = 'partial-match';

  execute(sources: LinkCandidate[], targets: LinkCandidate[], config: MatchingConfig): Result<StrategyResult, Error> {
    const links: NewTransactionLink[] = [];
    const consumedCandidateIds = new Set<number>();

    // Use relaxed config — lower confidence threshold, keep partial fraction
    const relaxedConfig: MatchingConfig = {
      ...config,
      minConfidenceScore: parseDecimal('0.5'),
      autoConfirmThreshold: parseDecimal('1.1'), // Never auto-confirm in partial strategy
    };

    const allMatches: PotentialMatch[] = [];
    for (const source of sources) {
      const matches = scoreAndFilterMatches(source, targets, relaxedConfig);
      allMatches.push(...matches);
    }

    if (allMatches.length === 0) {
      return ok({ links, consumedCandidateIds });
    }

    const { suggested } = allocateMatches(allMatches, relaxedConfig);

    const now = new Date();

    for (const match of suggested) {
      const linkResult = createTransactionLink(match, 'suggested', now);
      if (linkResult.isErr()) continue;
      links.push(linkResult.value);
      consumedCandidateIds.add(match.sourceMovement.id);
      consumedCandidateIds.add(match.targetMovement.id);
    }

    return ok({ links, consumedCandidateIds });
  }
}

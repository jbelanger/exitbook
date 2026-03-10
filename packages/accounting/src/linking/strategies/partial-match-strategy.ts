import { parseDecimal } from '@exitbook/core';
import { ok, type Result } from '@exitbook/core';

import { createTransactionLink } from '../matching/link-construction.js';
import { allocateMatches } from '../matching/match-allocation.js';
import type { LinkableMovement } from '../pre-linking/types.js';
import type { MatchingConfig, NewTransactionLink, PotentialMatch } from '../shared/types.js';

import { scoreAndFilterMatches } from './amount-timing-utils.js';
import { filterUnsupportedSameHashExternalPartials } from './hash-partial-feasibility-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

/**
 * Runs on remaining pool with relaxed thresholds to catch 1:N / N:1 patterns.
 * All links produced are 'suggested' status.
 */
export class PartialMatchStrategy implements ILinkingStrategy {
  readonly name = 'partial-match';

  execute(
    sources: LinkableMovement[],
    targets: LinkableMovement[],
    config: MatchingConfig
  ): Result<StrategyResult, Error> {
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

    const feasibleMatches = filterUnsupportedSameHashExternalPartials(allMatches);
    const { suggested } = allocateMatches(feasibleMatches, relaxedConfig);

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

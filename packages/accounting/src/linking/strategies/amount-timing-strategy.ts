import { ok, type NewTransactionLink, type Result } from '@exitbook/core';

import { createTransactionLink } from '../matching/link-construction.js';
import { allocateMatches } from '../matching/match-allocation.js';
import type { LinkableMovement } from '../pre-linking/types.js';
import type { MatchingConfig, PotentialMatch } from '../shared/types.js';

import { scoreAndFilterMatches } from './amount-timing-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

/**
 * The main heuristic matcher — scores all source/target pairs using
 * amount similarity, timing, address matching, and confidence scoring.
 * Uses capacity-based deduplication to handle 1:N and N:1 patterns.
 */
export class AmountTimingStrategy implements ILinkingStrategy {
  readonly name = 'amount-timing';

  execute(
    sources: LinkableMovement[],
    targets: LinkableMovement[],
    config: MatchingConfig
  ): Result<StrategyResult, Error> {
    const links: NewTransactionLink[] = [];
    const consumedCandidateIds = new Set<number>();

    // Collect all potential matches
    const allMatches: PotentialMatch[] = [];
    for (const source of sources) {
      const matches = scoreAndFilterMatches(source, targets, config);
      allMatches.push(...matches);
    }

    if (allMatches.length === 0) {
      return ok({ links, consumedCandidateIds });
    }

    // Capacity-based deduplication
    const { suggested, confirmed } = allocateMatches(allMatches, config);

    const now = new Date();

    // Convert confirmed matches to links
    for (const match of confirmed) {
      const linkResult = createTransactionLink(match, 'confirmed', now);
      if (linkResult.isErr()) continue;
      links.push(linkResult.value);
      consumedCandidateIds.add(match.sourceMovement.id);
      consumedCandidateIds.add(match.targetMovement.id);
    }

    // Convert suggested matches to links
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

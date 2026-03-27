import type { NewTransactionLink } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import { ok, type Result } from '@exitbook/foundation';

import { createTransactionLink } from '../matching/link-construction.js';
import type { LinkableMovement } from '../pre-linking/types.js';
import type { MatchingConfig } from '../shared/types.js';

import { calculateTimeDifferenceHours, determineLinkType, isTimingValid } from './amount-timing-utils.js';
import { areLinkingAssetsEquivalent } from './asset-equivalence-utils.js';
import { checkTransactionHashMatch } from './exact-hash-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

/**
 * Matches movements with the same normalized blockchain transaction hash.
 *
 * Skips pairs where both sides are blockchain (those are blockchain_internal
 * from the pre-linking phase). Handles multi-output scenarios.
 */
export class ExactHashStrategy implements ILinkingStrategy {
  readonly name = 'exact-hash';

  execute(
    sources: LinkableMovement[],
    targets: LinkableMovement[],
    config: MatchingConfig
  ): Result<StrategyResult, Error> {
    const links: NewTransactionLink[] = [];
    const consumedCandidateIds = new Set<number>();
    const now = new Date();

    for (const source of sources) {
      if (!source.blockchainTxHash) continue;

      // Find all targets with matching hash
      const hashTargets: LinkableMovement[] = [];
      for (const target of targets) {
        if (consumedCandidateIds.has(target.id)) continue;
        if (!areLinkingAssetsEquivalent(source, target)) continue;

        // Same-source guard
        if (source.platformKey === target.platformKey) continue;

        // Skip both-blockchain pairs (handled by pre-linking internal detection)
        if (source.platformKind === 'blockchain' && target.platformKind === 'blockchain') continue;

        const hashMatch = checkTransactionHashMatch(source, target);
        if (hashMatch === true) {
          hashTargets.push(target);
        }
      }

      if (hashTargets.length === 0) continue;

      // Validate multi-output: sum of targets must not exceed source
      if (hashTargets.length > 1) {
        const totalTargetAmount = hashTargets.reduce((sum, t) => sum.plus(t.amount), parseDecimal('0'));
        if (totalTargetAmount.greaterThan(source.amount)) {
          // Can't be valid multi-output — skip hash matching for this source
          continue;
        }
      }

      // Create links for each hash-matched target
      for (const target of hashTargets) {
        const linkType = determineLinkType(source.platformKind, target.platformKind);
        const timingHours = calculateTimeDifferenceHours(source.timestamp, target.timestamp);
        const timingValid = isTimingValid(source.timestamp, target.timestamp, config);

        const match = {
          sourceMovement: source,
          targetMovement: target,
          confidenceScore: parseDecimal('1.0'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid,
            timingHours,
            addressMatch: undefined,
            hashMatch: true,
          },
          linkType,
        };

        const linkResult = createTransactionLink(match, 'confirmed', now);
        if (linkResult.isErr()) continue;

        links.push(linkResult.value);
        consumedCandidateIds.add(source.id);
        consumedCandidateIds.add(target.id);
      }
    }

    return ok({ links, consumedCandidateIds });
  }
}

import { Decimal } from 'decimal.js';

import { validateLinkAmountsForMatch } from './link-construction.js';
import type { MatchingConfig, PotentialMatch } from './types.js';

/** Decision trace from capacity-based deduplication. Logged at debug level for audit. */
export interface DeduplicationDecision {
  sourceId: number;
  targetId: number;
  asset: string;
  action: 'accepted' | 'rejected_no_capacity' | 'rejected_fraction' | 'rejected_validation' | 'restored_1to1';
  consumed?: string | undefined;
  remainingSource?: string | undefined;
  remainingTarget?: string | undefined;
}

/**
 * Check if a match should be auto-confirmed based on confidence threshold
 *
 * @param match - Potential match
 * @param config - Matching configuration
 * @returns True if match should be auto-confirmed
 */
export function shouldAutoConfirm(match: PotentialMatch, config: MatchingConfig): boolean {
  return match.confidenceScore.greaterThanOrEqualTo(config.autoConfirmThreshold);
}

/**
 * Capacity-based deduplication for transaction matching.
 *
 * Each source/target has a "remaining capacity" equal to its original amount.
 * When a match is accepted, the consumed amount (= min of remaining source capacity,
 * remaining target capacity) is subtracted from both sides.
 *
 * For 1:1 results (source and target each appear in exactly one link), consumed amounts
 * are stripped so that original amount semantics are preserved (important for gap analysis
 * and fee handling).
 *
 * Invariant: Each (sourceId, targetId, assetSymbol) triple produces at most one link,
 * so override fingerprints remain unique.
 *
 * Known limitation: The greedy approach (process by confidence, consume capacity) is not
 * globally optimal. A min-cost-flow algorithm could produce better overall matches when
 * multiple sources compete for the same target. In practice, confidence scoring already
 * prioritizes exact matches (amountSimilarity 1.0), and hash matches get confidence 1.0,
 * so the greedy result is near-optimal for real-world data. Can be upgraded later if needed.
 */
export function deduplicateWithCapacity(
  sortedMatches: PotentialMatch[],
  config: MatchingConfig
): { decisions: DeduplicationDecision[]; matches: PotentialMatch[] } {
  const makeKey = (txId: number, assetSymbol: string): string => `${txId}:${assetSymbol}`;

  // --- Pass 1: Greedy capacity allocation ---
  const sourceCapacity = new Map<string, Decimal>();
  const targetCapacity = new Map<string, Decimal>();
  const deduplicatedMatches: PotentialMatch[] = [];
  const decisions: DeduplicationDecision[] = [];

  for (const match of sortedMatches) {
    const sourceKey = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
    const targetKey = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);

    // Initialize capacity on first encounter
    if (!sourceCapacity.has(sourceKey)) {
      sourceCapacity.set(sourceKey, match.sourceTransaction.amount);
    }
    if (!targetCapacity.has(targetKey)) {
      targetCapacity.set(targetKey, match.targetTransaction.amount);
    }

    const remainingSource = sourceCapacity.get(sourceKey)!;
    const remainingTarget = targetCapacity.get(targetKey)!;

    // Both must have remaining capacity
    if (remainingSource.lte(0) || remainingTarget.lte(0)) {
      decisions.push({
        sourceId: match.sourceTransaction.id,
        targetId: match.targetTransaction.id,
        asset: match.sourceTransaction.assetSymbol,
        action: 'rejected_no_capacity',
        remainingSource: remainingSource.toFixed(),
        remainingTarget: remainingTarget.toFixed(),
      });
      continue;
    }

    // Consumed = min(remaining source, remaining target)
    const consumed = Decimal.min(remainingSource, remainingTarget);

    // Reject if consumed amount is too small relative to the larger original amount.
    // This prevents garbage matches (e.g., source=10 matching a target=0.01).
    const largerOriginal = Decimal.max(match.sourceTransaction.amount, match.targetTransaction.amount);
    if (consumed.lt(largerOriginal.times(config.minPartialMatchFraction))) {
      decisions.push({
        sourceId: match.sourceTransaction.id,
        targetId: match.targetTransaction.id,
        asset: match.sourceTransaction.assetSymbol,
        action: 'rejected_fraction',
        consumed: consumed.toFixed(),
        remainingSource: remainingSource.toFixed(),
        remainingTarget: remainingTarget.toFixed(),
      });
      continue;
    }

    // Accept this match with consumed amount
    deduplicatedMatches.push({
      ...match,
      consumedAmount: consumed,
    });

    decisions.push({
      sourceId: match.sourceTransaction.id,
      targetId: match.targetTransaction.id,
      asset: match.sourceTransaction.assetSymbol,
      action: 'accepted',
      consumed: consumed.toFixed(),
      remainingSource: remainingSource.minus(consumed).toFixed(),
      remainingTarget: remainingTarget.minus(consumed).toFixed(),
    });

    // Subtract consumed capacity
    sourceCapacity.set(sourceKey, remainingSource.minus(consumed));
    targetCapacity.set(targetKey, remainingTarget.minus(consumed));
  }

  // --- Pass 2: 1:1 Restoration + Validation ---
  //
  // For matches where both the source and target participate in exactly ONE link,
  // strip consumed amounts. This preserves original 1:1 semantics:
  //
  //   - Fee handling: source=1.0, target=0.999 → link stores (1.0, 0.999), not (0.999, 0.999)
  //   - Gap analysis: sums link.sourceAmount against outflow totals. If we stored consumed=0.999
  //     but the outflow was 1.0, gap analysis would see 0.001 uncovered → false gap.
  //
  // Only actual splits (1:N or N:1) retain consumed amounts.
  //
  // When a 1:1 match fails validation after restoration (e.g., target > source),
  // it is dropped and its capacity is released for a retry pass.

  const sourceMatchCount = new Map<string, number>();
  const targetMatchCount = new Map<string, number>();

  for (const match of deduplicatedMatches) {
    const sourceKey = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
    const targetKey = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);
    sourceMatchCount.set(sourceKey, (sourceMatchCount.get(sourceKey) ?? 0) + 1);
    targetMatchCount.set(targetKey, (targetMatchCount.get(targetKey) ?? 0) + 1);
  }

  const restoredMatches: PotentialMatch[] = [];
  const rejectedKeys = new Set<string>(); // source/target keys freed by validation failures
  const acceptedPairs = new Set<string>(); // "sourceId:targetId" pairs already accepted

  for (const match of deduplicatedMatches) {
    const sourceKey = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
    const targetKey = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);
    const isPure1to1 = (sourceMatchCount.get(sourceKey) ?? 0) === 1 && (targetMatchCount.get(targetKey) ?? 0) === 1;

    if (isPure1to1) {
      const restoredMatch: PotentialMatch = { ...match };
      delete restoredMatch.consumedAmount;
      const validationResult = validateLinkAmountsForMatch(restoredMatch);
      if (validationResult.isErr()) {
        decisions.push({
          sourceId: match.sourceTransaction.id,
          targetId: match.targetTransaction.id,
          asset: match.sourceTransaction.assetSymbol,
          action: 'rejected_validation',
          remainingSource: match.sourceTransaction.amount.toFixed(),
          remainingTarget: match.targetTransaction.amount.toFixed(),
        });
        // Release capacity for retry pass
        rejectedKeys.add(sourceKey);
        rejectedKeys.add(targetKey);
        continue;
      }

      decisions.push({
        sourceId: match.sourceTransaction.id,
        targetId: match.targetTransaction.id,
        asset: match.sourceTransaction.assetSymbol,
        action: 'restored_1to1',
      });
      restoredMatches.push(restoredMatch);
    } else {
      restoredMatches.push(match);
    }
    acceptedPairs.add(`${match.sourceTransaction.id}:${match.targetTransaction.id}`);
  }

  // --- Pass 3: Retry with freed capacity ---
  //
  // When a 1:1 match is rejected during restoration, the source/target capacity it consumed
  // becomes available again. Re-run the greedy pass over the original sorted matches,
  // skipping already-accepted pairs and the rejected pair, with fresh capacity for freed keys.

  if (rejectedKeys.size > 0) {
    // Reset capacity for freed sources/targets
    const retrySourceCapacity = new Map<string, Decimal>();
    const retryTargetCapacity = new Map<string, Decimal>();

    // Freed keys get full original capacity back
    // Non-freed keys keep whatever capacity remains after pass 1
    // (but we only care about candidates that touch a freed key)

    for (const match of sortedMatches) {
      const sourceKey = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
      const targetKey = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);

      // Only retry matches that involve at least one freed key
      if (!rejectedKeys.has(sourceKey) && !rejectedKeys.has(targetKey)) continue;

      // Skip already-accepted pairs
      if (acceptedPairs.has(`${match.sourceTransaction.id}:${match.targetTransaction.id}`)) continue;

      // Initialize retry capacity
      if (!retrySourceCapacity.has(sourceKey)) {
        retrySourceCapacity.set(
          sourceKey,
          rejectedKeys.has(sourceKey)
            ? match.sourceTransaction.amount // freed: full capacity
            : (sourceCapacity.get(sourceKey) ?? match.sourceTransaction.amount) // keep remaining
        );
      }
      if (!retryTargetCapacity.has(targetKey)) {
        retryTargetCapacity.set(
          targetKey,
          rejectedKeys.has(targetKey)
            ? match.targetTransaction.amount // freed: full capacity
            : (targetCapacity.get(targetKey) ?? match.targetTransaction.amount) // keep remaining
        );
      }

      const remainingSource = retrySourceCapacity.get(sourceKey)!;
      const remainingTarget = retryTargetCapacity.get(targetKey)!;

      if (remainingSource.lte(0) || remainingTarget.lte(0)) continue;

      const consumed = Decimal.min(remainingSource, remainingTarget);
      const largerOriginal = Decimal.max(match.sourceTransaction.amount, match.targetTransaction.amount);
      if (consumed.lt(largerOriginal.times(config.minPartialMatchFraction))) continue;

      // Pre-validate with original amounts (will be restored if 1:1)
      const preValidation = validateLinkAmountsForMatch(match);
      if (preValidation.isErr()) continue;

      restoredMatches.push({
        ...match,
        consumedAmount: consumed,
      });

      decisions.push({
        sourceId: match.sourceTransaction.id,
        targetId: match.targetTransaction.id,
        asset: match.sourceTransaction.assetSymbol,
        action: 'accepted',
        consumed: consumed.toFixed(),
        remainingSource: remainingSource.minus(consumed).toFixed(),
        remainingTarget: remainingTarget.minus(consumed).toFixed(),
      });

      retrySourceCapacity.set(sourceKey, remainingSource.minus(consumed));
      retryTargetCapacity.set(targetKey, remainingTarget.minus(consumed));
      acceptedPairs.add(`${match.sourceTransaction.id}:${match.targetTransaction.id}`);
    }

    // --- Retry restoration pass: strip consumed amounts for new 1:1 matches ---
    const retrySourceCount = new Map<string, number>();
    const retryTargetCount = new Map<string, number>();
    for (const match of restoredMatches) {
      const sk = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
      const tk = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);
      retrySourceCount.set(sk, (retrySourceCount.get(sk) ?? 0) + 1);
      retryTargetCount.set(tk, (retryTargetCount.get(tk) ?? 0) + 1);
    }

    for (let i = 0; i < restoredMatches.length; i++) {
      const match = restoredMatches[i]!;
      if (match.consumedAmount === undefined) continue; // already restored
      const sk = makeKey(match.sourceTransaction.id, match.sourceTransaction.assetSymbol);
      const tk = makeKey(match.targetTransaction.id, match.targetTransaction.assetSymbol);
      if ((retrySourceCount.get(sk) ?? 0) === 1 && (retryTargetCount.get(tk) ?? 0) === 1) {
        const restored = { ...match };
        delete restored.consumedAmount;
        restoredMatches[i] = restored;
        decisions.push({
          sourceId: match.sourceTransaction.id,
          targetId: match.targetTransaction.id,
          asset: match.sourceTransaction.assetSymbol,
          action: 'restored_1to1',
        });
      }
    }
  }

  return { matches: restoredMatches, decisions };
}

/**
 * Allocate the best non-overlapping set of matches from all candidates.
 *
 * Uses capacity-based deduplication: each source/target has remaining capacity equal to its
 * original amount. A source with amount=10 can match target1=5 and target2=5, consuming
 * 5+5=10 of its capacity. For pure 1:1 results, consumed amounts are stripped (restoration pass).
 *
 * Greedy selection by confidence (highest first), with hash matches prioritized as tiebreaker.
 *
 * Separates results into confirmed vs suggested based on confidence threshold.
 *
 * @param matches - All potential matches
 * @param config - Matching configuration
 * @returns Object with confirmed matches, suggested matches, and decision audit trail
 */
export function allocateMatches(
  matches: PotentialMatch[],
  config: MatchingConfig
): {
  confirmed: PotentialMatch[];
  decisions: DeduplicationDecision[];
  suggested: PotentialMatch[];
} {
  // Sort all matches by confidence (highest first), with hash matches prioritized as tiebreaker.
  // This ensures the best matches consume capacity first.
  const sortedMatches = [...matches].sort((a, b) => {
    const confidenceComparison = b.confidenceScore.comparedTo(a.confidenceScore);
    if (confidenceComparison !== 0) return confidenceComparison;

    // Tiebreaker: hash matches before non-hash matches
    const aIsHash = a.matchCriteria.hashMatch === true;
    const bIsHash = b.matchCriteria.hashMatch === true;
    if (aIsHash && !bIsHash) return -1;
    if (!aIsHash && bIsHash) return 1;
    return 0;
  });

  const { matches: deduplicatedMatches, decisions } = deduplicateWithCapacity(sortedMatches, config);

  const suggested: PotentialMatch[] = [];
  const confirmed: PotentialMatch[] = [];

  // Separate into confirmed vs suggested based on confidence threshold
  for (const match of deduplicatedMatches) {
    if (shouldAutoConfirm(match, config)) {
      confirmed.push(match);
    } else {
      suggested.push(match);
    }
  }

  return { suggested, confirmed, decisions };
}

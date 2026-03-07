import type { SourceType } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type { LinkCandidate } from '../link-candidate.js';
import type { LinkType, MatchCriteria, MatchingConfig, PotentialMatch, ScoreComponent } from '../types.js';

import { checkTransactionHashMatch } from './exact-hash-utils.js';

/**
 * Calculate amount similarity between two amounts (0-1 score)
 * Accounts for transfer fees by allowing the target to be slightly less than source
 *
 * @param sourceAmount - The withdrawal/send amount
 * @param targetAmount - The deposit/receive amount
 * @returns Similarity score from 0 to 1, where 1 is exact match
 */
export function calculateAmountSimilarity(sourceAmount: Decimal, targetAmount: Decimal): Decimal {
  if (sourceAmount.isZero() || targetAmount.isZero()) {
    return parseDecimal('0');
  }

  // Target should be <= source (accounting for fees)
  if (targetAmount.greaterThan(sourceAmount)) {
    // If target > source, penalize heavily but allow small differences (rounding)
    const difference = targetAmount.minus(sourceAmount);
    const percentDiff = difference.dividedBy(sourceAmount).abs();

    // Allow up to 0.1% difference for rounding
    if (percentDiff.lessThanOrEqualTo(0.001)) {
      return parseDecimal('0.99');
    }

    return parseDecimal('0'); // Target shouldn't be larger than source
  }

  // Calculate similarity as target/source (higher is better)
  const similarity = targetAmount.dividedBy(sourceAmount);

  // Clamp to [0, 1]
  return Decimal.min(Decimal.max(similarity, parseDecimal('0')), parseDecimal('1'));
}

/**
 * Calculate time difference in hours between two timestamps
 *
 * @param sourceTime - The earlier timestamp (withdrawal/send)
 * @param targetTime - The later timestamp (deposit/receive)
 * @returns Hours between timestamps, or Infinity if ordering is wrong
 */
export function calculateTimeDifferenceHours(sourceTime: Date, targetTime: Date): number {
  const diffMs = targetTime.getTime() - sourceTime.getTime();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Check if timing is valid based on config
 *
 * @param sourceTime - The withdrawal/send time
 * @param targetTime - The deposit/receive time
 * @param config - Matching configuration
 * @returns True if timing is within acceptable window
 */
export function isTimingValid(sourceTime: Date, targetTime: Date, config: MatchingConfig): boolean {
  const hours = calculateTimeDifferenceHours(sourceTime, targetTime);
  return hours >= -config.clockSkewToleranceHours && hours <= config.maxTimingWindowHours;
}

/**
 * Determine link type based on source and target types
 *
 * @param sourceType - Source transaction type
 * @param targetType - Target transaction type
 * @returns Link type
 */
export function determineLinkType(sourceType: SourceType, targetType: SourceType): LinkType {
  if (sourceType === 'exchange' && targetType === 'blockchain') {
    return 'exchange_to_blockchain';
  }

  if (sourceType === 'blockchain' && targetType === 'blockchain') {
    return 'blockchain_to_blockchain';
  }

  if (sourceType === 'exchange' && targetType === 'exchange') {
    return 'exchange_to_exchange';
  }

  // Shouldn't happen (blockchain → exchange is unusual)
  return 'exchange_to_blockchain';
}

/**
 * Check if blockchain addresses match (if available)
 *
 * Compares source destination address (`to`) against target endpoint addresses.
 * Target endpoint may be available as either `to` (preferred) or `from`
 * depending on source-specific ingestion details.
 *
 * @param source - Source movement with destination address
 * @param target - Target movement with endpoint addresses
 * @returns True if addresses match, false if they conflict, undefined if unavailable
 */
export function checkAddressMatch(source: LinkCandidate, target: LinkCandidate): boolean | undefined {
  const targetDestinationAddress = target.toAddress;
  const targetSourceAddress = target.fromAddress;

  // No target addresses available — inconclusive
  if (!targetDestinationAddress && !targetSourceAddress) {
    return undefined;
  }

  // Try source.toAddress → target (standard: withdrawal destination matches deposit endpoint)
  const sourceDestinationAddress = source.toAddress;
  if (sourceDestinationAddress) {
    const normalized = sourceDestinationAddress.toLowerCase();
    if (targetDestinationAddress && normalized === targetDestinationAddress.toLowerCase()) {
      return true;
    }
    if (targetSourceAddress && normalized === targetSourceAddress.toLowerCase()) {
      return true;
    }
  }

  // Try source.fromAddress → target.toAddress
  // Covers blockchain→exchange: user's sending address matches exchange deposit address
  const sourceOriginAddress = source.fromAddress;
  if (sourceOriginAddress) {
    if (targetDestinationAddress && sourceOriginAddress.toLowerCase() === targetDestinationAddress.toLowerCase()) {
      return true;
    }
  }

  // If neither source address was available, we can't compare — inconclusive
  if (!sourceDestinationAddress && !sourceOriginAddress) {
    return undefined;
  }

  // Addresses were available on both sides but none matched — mismatch
  return false;
}

/**
 * Calculate overall confidence score based on match criteria.
 *
 * Returns both the final score and a breakdown array showing how each
 * signal contributed — useful for audit trails and debugging.
 *
 * @param criteria - Match criteria
 * @returns Object with score (0-1) and breakdown of weighted components
 */
export function calculateConfidenceScore(criteria: MatchCriteria): {
  breakdown: ScoreComponent[];
  score: Decimal;
} {
  const breakdown: ScoreComponent[] = [];
  let score = parseDecimal('0');

  // Asset match is mandatory (30% weight) — hard veto if false
  if (!criteria.assetMatch) {
    return { score: parseDecimal('0'), breakdown: [] };
  }

  const assetBase = parseDecimal('0.3');
  breakdown.push({ signal: 'asset_match', weight: assetBase, value: parseDecimal('1'), contribution: assetBase });
  score = score.plus(assetBase);

  // Amount similarity (40% weight)
  const amountWeight = parseDecimal('0.4');
  const amountContribution = criteria.amountSimilarity.times(amountWeight);
  breakdown.push({
    signal: 'amount_similarity',
    weight: amountWeight,
    value: criteria.amountSimilarity,
    contribution: amountContribution,
  });
  score = score.plus(amountContribution);

  // Timing validity (20% weight)
  if (criteria.timingValid) {
    const timingWeight = parseDecimal('0.2');
    breakdown.push({
      signal: 'timing_valid',
      weight: timingWeight,
      value: parseDecimal('1'),
      contribution: timingWeight,
    });
    score = score.plus(timingWeight);

    // Bonus for very close timing (within 1 hour = extra 5%)
    if (criteria.timingHours <= 1) {
      const timingBonus = parseDecimal('0.05');
      breakdown.push({
        signal: 'timing_close_bonus',
        weight: timingBonus,
        value: parseDecimal('1'),
        contribution: timingBonus,
      });
      score = score.plus(timingBonus);
    }
  }

  // Address match bonus (10% weight) — hard veto if explicitly false
  if (criteria.addressMatch === true) {
    const addressWeight = parseDecimal('0.1');
    breakdown.push({
      signal: 'address_match',
      weight: addressWeight,
      value: parseDecimal('1'),
      contribution: addressWeight,
    });
    score = score.plus(addressWeight);
  } else if (criteria.addressMatch === false) {
    return { score: parseDecimal('0'), breakdown: [] };
  }

  // Clamp to [0, 1] and round to 6 decimal places for deterministic threshold comparisons
  score = Decimal.min(Decimal.max(score, parseDecimal('0')), parseDecimal('1')).toDecimalPlaces(
    6,
    Decimal.ROUND_HALF_UP
  );

  return { score, breakdown };
}

/**
 * Calculate fee-aware amount similarity by trying multiple gross/net comparison patterns.
 *
 * UTXO chains record grossAmount (total inputs) and netAmount (gross - fee) separately.
 * The counterparty (e.g., an exchange) may record either the gross or net amount.
 * This function tries all available amount pairs and returns the best similarity.
 *
 * Patterns tried:
 *  1. source.amount vs target.amount           (net vs net — standard)
 *  2. source.grossAmount vs target.amount       (gross vs net — UTXO send vs exchange deposit)
 *  3. source.amount vs target.grossAmount       (net vs gross — reversed)
 */
export function calculateFeeAwareAmountSimilarity(source: LinkCandidate, target: LinkCandidate): Decimal {
  // Always try the primary amounts first
  let best = calculateAmountSimilarity(source.amount, target.amount);

  // If source has a different grossAmount, try gross vs target
  if (source.grossAmount && best.lessThan(parseDecimal('1'))) {
    const sim = calculateAmountSimilarity(source.grossAmount, target.amount);
    if (sim.greaterThan(best)) best = sim;
  }

  // If target has a different grossAmount, try source vs gross
  if (target.grossAmount && best.lessThan(parseDecimal('1'))) {
    const sim = calculateAmountSimilarity(source.amount, target.grossAmount);
    if (sim.greaterThan(best)) best = sim;
  }

  return best;
}

/**
 * Build match criteria for two link candidates
 *
 * @param source - Source movement (withdrawal/send)
 * @param target - Target movement (deposit/receive)
 * @param config - Matching configuration
 * @returns Match criteria
 */
export function buildMatchCriteria(
  source: LinkCandidate,
  target: LinkCandidate,
  config: MatchingConfig
): MatchCriteria {
  const assetMatch = source.assetSymbol === target.assetSymbol;
  const amountSimilarity = calculateFeeAwareAmountSimilarity(source, target);
  const timingHours = calculateTimeDifferenceHours(source.timestamp, target.timestamp);
  const timingValid = isTimingValid(source.timestamp, target.timestamp, config);
  const addressMatch = checkAddressMatch(source, target);

  return {
    assetMatch,
    amountSimilarity,
    timingValid,
    timingHours,
    addressMatch,
  };
}

/**
 * Score and filter matches for a source movement from a list of target movements.
 *
 * Evaluates all targets against the source using hard filters (asset, direction, timing,
 * amount similarity, confidence), handles hash-match fast-path for blockchain transactions,
 * and returns matches sorted by confidence (highest first).
 *
 * @param source - Source movement (withdrawal/send)
 * @param targets - List of target movements (deposits/receives)
 * @param config - Matching configuration
 * @returns Array of potential matches sorted by confidence (highest first)
 */
export function scoreAndFilterMatches(
  source: LinkCandidate,
  targets: LinkCandidate[],
  config: MatchingConfig
): PotentialMatch[] {
  const matches: PotentialMatch[] = [];

  for (const target of targets) {
    // Prevent self-matching (movements from the same transaction)
    if (source.transactionId === target.transactionId) continue;

    // Quick filters
    if (source.assetSymbol !== target.assetSymbol) continue;
    if (source.direction !== 'out' || target.direction !== 'in') continue;

    // Same-source guard: matching within the same source is meaningless for transfer linking.
    // - Exchange: same exchange → skip (internal transfer, not a cross-source link)
    // - Blockchain: same blockchain → skip heuristic matches (unrelated on-chain events).
    //   Blockchain same-source matches only make sense with a tx hash match, which is
    //   handled above this guard.
    if (source.sourceName === target.sourceName) continue;

    // Check for transaction hash match (perfect match)
    const hashMatch = checkTransactionHashMatch(source, target);
    const bothAreBlockchain = source.sourceType === 'blockchain' && target.sourceType === 'blockchain';

    // blockchain_internal links (same tx hash, different tracked addresses) are created by
    // detectInternalBlockchainTransfers — skip heuristic matching for these pairs entirely.
    if (hashMatch === true && bothAreBlockchain) continue;

    if (hashMatch === true && !bothAreBlockchain) {
      // Perfect match - same blockchain transaction hash
      // For multi-output scenarios (one source → multiple targets with same hash):
      // Validate that sum of all target amounts doesn't exceed source amount

      // Find all eligible targets with same hash and asset
      // Use checkTransactionHashMatch to ensure consistent log-index handling
      const targetsWithSameHash = targets.filter((t) => {
        if (t.transactionId === source.transactionId) return false; // Exclude self
        if (t.assetSymbol !== source.assetSymbol) return false;
        if (t.direction !== 'in') return false;

        // Use checkTransactionHashMatch to ensure same log-index rules are applied
        // (e.g., when both have log indices, requires exact match)
        return checkTransactionHashMatch(source, t) === true;
      });

      // If multiple targets, validate total doesn't exceed source
      if (targetsWithSameHash.length > 1) {
        const totalTargetAmount = targetsWithSameHash.reduce((sum, t) => sum.plus(t.amount), parseDecimal('0'));

        // If sum of targets exceeds source, this can't be valid - fall back to heuristic
        if (totalTargetAmount.greaterThan(source.amount)) {
          // Fall through to normal matching logic
        } else {
          // Valid multi-output: source amount >= sum of targets
          const linkType = determineLinkType(source.sourceType, target.sourceType);
          const timingHours = calculateTimeDifferenceHours(source.timestamp, target.timestamp);
          const timingValid = isTimingValid(source.timestamp, target.timestamp, config);

          matches.push({
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
          });
          continue;
        }
      } else {
        // Single target with hash match - always valid
        const linkType = determineLinkType(source.sourceType, target.sourceType);
        const timingHours = calculateTimeDifferenceHours(source.timestamp, target.timestamp);
        const timingValid = isTimingValid(source.timestamp, target.timestamp, config);

        matches.push({
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
        });
        continue;
      }
    }

    // Build criteria for normal (non-hash) matching
    const criteria = buildMatchCriteria(source, target, config);

    // Enforce timing validity as a hard threshold
    // Target must come after source and be within the time window
    if (!criteria.timingValid) {
      continue;
    }

    // Calculate confidence
    const { score: confidenceScore, breakdown } = calculateConfidenceScore(criteria);

    // Filter by minimum confidence
    if (confidenceScore.lessThan(config.minConfidenceScore)) {
      continue;
    }

    // Determine link type
    const linkType = determineLinkType(source.sourceType, target.sourceType);

    matches.push({
      sourceMovement: source,
      targetMovement: target,
      confidenceScore,
      matchCriteria: criteria,
      linkType,
      scoreBreakdown: breakdown,
    });
  }

  // Sort by confidence (highest first)
  return matches.sort((a, b) => b.confidenceScore.comparedTo(a.confidenceScore));
}

import { Decimal } from 'decimal.js';

import type { LinkType, MatchCriteria, MatchingConfig, PotentialMatch, TransactionCandidate } from './types.js';

/**
 * Default matching configuration
 */
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  maxTimingWindowHours: 48,
  minAmountSimilarity: new Decimal('0.95'),
  minConfidenceScore: new Decimal('0.7'),
  autoConfirmThreshold: new Decimal('0.95'),
};

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
    return new Decimal(0);
  }

  // Target should be <= source (accounting for fees)
  if (targetAmount.greaterThan(sourceAmount)) {
    // If target > source, penalize heavily but allow small differences (rounding)
    const difference = targetAmount.minus(sourceAmount);
    const percentDiff = difference.dividedBy(sourceAmount).abs();

    // Allow up to 0.1% difference for rounding
    if (percentDiff.lessThanOrEqualTo(0.001)) {
      return new Decimal(0.99);
    }

    return new Decimal(0); // Target shouldn't be larger than source
  }

  // Calculate similarity as target/source (higher is better)
  const similarity = targetAmount.dividedBy(sourceAmount);

  // Clamp to [0, 1]
  return Decimal.min(Decimal.max(similarity, new Decimal(0)), new Decimal(1));
}

/**
 * Calculate time difference in hours between two timestamps
 *
 * @param sourceTime - The earlier timestamp (withdrawal/send)
 * @param targetTime - The later timestamp (deposit/receive)
 * @returns Hours between timestamps, or Infinity if ordering is wrong
 */
export function calculateTimeDifferenceHours(sourceTime: Date, targetTime: Date): number {
  const sourceMs = sourceTime.getTime();
  const targetMs = targetTime.getTime();

  // Source must be before target
  if (sourceMs > targetMs) {
    return Infinity;
  }

  const diffMs = targetMs - sourceMs;
  return diffMs / (1000 * 60 * 60); // Convert to hours
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
  return hours >= 0 && hours <= config.maxTimingWindowHours;
}

/**
 * Determine link type based on source and target types
 *
 * @param sourceType - Source transaction type
 * @param targetType - Target transaction type
 * @returns Link type
 */
export function determineLinkType(
  sourceType: 'exchange' | 'blockchain',
  targetType: 'exchange' | 'blockchain'
): LinkType {
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
 * @param sourceTransaction - Source transaction with to_address
 * @param targetTransaction - Target transaction with from_address
 * @returns True if addresses match, undefined if addresses not available
 */
export function checkAddressMatch(
  sourceTransaction: TransactionCandidate,
  targetTransaction: TransactionCandidate
): boolean | undefined {
  const sourceToAddress = sourceTransaction.toAddress;
  const targetFromAddress = targetTransaction.fromAddress;

  // If both addresses are available, compare them
  if (sourceToAddress && targetFromAddress) {
    // Normalize addresses (case-insensitive comparison)
    return sourceToAddress.toLowerCase() === targetFromAddress.toLowerCase();
  }

  // If addresses not available, return undefined
  return undefined;
}

/**
 * Calculate overall confidence score based on match criteria
 *
 * @param criteria - Match criteria
 * @returns Confidence score from 0 to 1
 */
export function calculateConfidenceScore(criteria: MatchCriteria): Decimal {
  let score = new Decimal(0);

  // Asset match is mandatory (30% weight)
  if (criteria.assetMatch) {
    score = score.plus(0.3);
  } else {
    return new Decimal(0); // No match if assets don't match
  }

  // Amount similarity (40% weight)
  const amountWeight = criteria.amountSimilarity.times(0.4);
  score = score.plus(amountWeight);

  // Timing validity (20% weight)
  if (criteria.timingValid) {
    score = score.plus(0.2);

    // Bonus for very close timing (within 1 hour = extra 5%)
    if (criteria.timingHours <= 1) {
      score = score.plus(0.05);
    }
  }

  // Address match bonus (10% weight)
  if (criteria.addressMatch === true) {
    score = score.plus(0.1);
  } else if (criteria.addressMatch === false) {
    // Addresses don't match - significant penalty
    return new Decimal(0);
  }

  // Clamp to [0, 1]
  return Decimal.min(Decimal.max(score, new Decimal(0)), new Decimal(1));
}

/**
 * Build match criteria for two transaction candidates
 *
 * @param source - Source transaction (withdrawal/send)
 * @param target - Target transaction (deposit/receive)
 * @param config - Matching configuration
 * @returns Match criteria
 */
export function buildMatchCriteria(
  source: TransactionCandidate,
  target: TransactionCandidate,
  config: MatchingConfig
): MatchCriteria {
  const assetMatch = source.asset === target.asset;
  const amountSimilarity = calculateAmountSimilarity(source.amount, target.amount);
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
 * Find potential matches for a source transaction from a list of target candidates
 *
 * @param source - Source transaction (withdrawal/send)
 * @param targets - List of target candidates (deposits/receives)
 * @param config - Matching configuration
 * @returns Array of potential matches sorted by confidence (highest first)
 */
export function findPotentialMatches(
  source: TransactionCandidate,
  targets: TransactionCandidate[],
  config: MatchingConfig
): PotentialMatch[] {
  const matches: PotentialMatch[] = [];

  for (const target of targets) {
    // Quick filters
    if (source.asset !== target.asset) continue;
    if (source.direction !== 'out' || target.direction !== 'in') continue;

    // Build criteria
    const criteria = buildMatchCriteria(source, target, config);

    // Calculate confidence
    const confidenceScore = calculateConfidenceScore(criteria);

    // Filter by minimum confidence
    if (confidenceScore.lessThan(config.minConfidenceScore)) {
      continue;
    }

    // Determine link type
    const linkType = determineLinkType(source.sourceType, target.sourceType);

    matches.push({
      sourceTransaction: source,
      targetTransaction: target,
      confidenceScore,
      matchCriteria: criteria,
      linkType,
    });
  }

  // Sort by confidence (highest first)
  return matches.sort((a, b) => b.confidenceScore.comparedTo(a.confidenceScore));
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

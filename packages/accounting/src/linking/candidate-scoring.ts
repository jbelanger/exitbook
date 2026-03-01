import type { SourceType } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type { LinkType, MatchCriteria, MatchingConfig, PotentialMatch, TransactionCandidate } from './types.js';

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
 * @param sourceTransaction - Source transaction with destination address
 * @param targetTransaction - Target transaction with endpoint addresses
 * @returns True if addresses match, false if they conflict, undefined if unavailable
 */
export function checkAddressMatch(
  sourceTransaction: TransactionCandidate,
  targetTransaction: TransactionCandidate
): boolean | undefined {
  const sourceDestinationAddress = sourceTransaction.toAddress;
  if (!sourceDestinationAddress) {
    return undefined;
  }

  const targetDestinationAddress = targetTransaction.toAddress;
  const targetSourceAddress = targetTransaction.fromAddress;
  if (!targetDestinationAddress && !targetSourceAddress) {
    return undefined;
  }

  const normalizedSource = sourceDestinationAddress.toLowerCase();
  if (targetDestinationAddress && normalizedSource === targetDestinationAddress.toLowerCase()) {
    return true;
  }

  if (targetSourceAddress && normalizedSource === targetSourceAddress.toLowerCase()) {
    return true;
  }

  return false;
}

/**
 * Normalize a blockchain transaction hash by removing log index suffix.
 * Some providers (e.g., Moralis) append `-{logIndex}` to differentiate token transfers
 * within the same transaction, while others (e.g., Routescan) don't provide log index.
 *
 * Examples:
 * - 0xabc123-819 → 0xabc123
 * - 0xabc123 → 0xabc123
 *
 * @param txHash - Transaction hash, potentially with log index suffix
 * @returns Normalized transaction hash without suffix
 */
export function normalizeTransactionHash(txHash: string): string {
  // Strip -<number> suffix if present (log index from Moralis, etc.)
  return txHash.replace(/-\d+$/, '');
}

/**
 * Check if blockchain transaction hashes match (if both available).
 * Uses hash normalization to handle provider inconsistencies (e.g., log index suffixes).
 *
 * Safety: Only strips log index when one side has it and the other doesn't. If both
 * sides have log indices, requires exact match to prevent batched transfers from
 * collapsing into the same match.
 *
 * @param sourceTransaction - Source transaction
 * @param targetTransaction - Target transaction
 * @returns True if hashes match, undefined if either hash not available
 */
export function checkTransactionHashMatch(
  sourceTransaction: TransactionCandidate,
  targetTransaction: TransactionCandidate
): boolean | undefined {
  const sourceHash = sourceTransaction.blockchainTransactionHash;
  const targetHash = targetTransaction.blockchainTransactionHash;

  // Both must have hashes to compare
  if (!sourceHash || !targetHash) {
    return undefined;
  }

  // Check if each hash has a log index suffix
  const sourceHasLogIndex = /-\d+$/.test(sourceHash);
  const targetHasLogIndex = /-\d+$/.test(targetHash);

  let normalizedSource: string;
  let normalizedTarget: string;

  if (sourceHasLogIndex && targetHasLogIndex) {
    // Both have log indices - require exact match (don't strip)
    // This prevents batched transfers from collapsing into the same match
    normalizedSource = sourceHash;
    normalizedTarget = targetHash;
  } else if (sourceHasLogIndex || targetHasLogIndex) {
    // Only one has log index - strip it for comparison
    normalizedSource = normalizeTransactionHash(sourceHash);
    normalizedTarget = normalizeTransactionHash(targetHash);
  } else {
    // Neither has log index - compare as-is
    normalizedSource = sourceHash;
    normalizedTarget = targetHash;
  }

  // Only lowercase hex hashes (0x prefix) - Solana/Cardano hashes are case-sensitive
  const isHexHash = normalizedSource.startsWith('0x') || normalizedTarget.startsWith('0x');
  if (isHexHash) {
    return normalizedSource.toLowerCase() === normalizedTarget.toLowerCase();
  }

  // Case-sensitive comparison for non-hex hashes (Solana base58, etc.)
  return normalizedSource === normalizedTarget;
}

/**
 * Calculate overall confidence score based on match criteria
 *
 * @param criteria - Match criteria
 * @returns Confidence score from 0 to 1
 */
export function calculateConfidenceScore(criteria: MatchCriteria): Decimal {
  let score = parseDecimal('0');

  // Asset match is mandatory (30% weight)
  if (criteria.assetMatch) {
    score = score.plus(parseDecimal('0.3'));
  } else {
    return parseDecimal('0'); // No match if assets don't match
  }

  // Amount similarity (40% weight)
  const amountWeight = criteria.amountSimilarity.times(parseDecimal('0.4'));
  score = score.plus(amountWeight);

  // Timing validity (20% weight)
  if (criteria.timingValid) {
    score = score.plus(parseDecimal('0.2'));

    // Bonus for very close timing (within 1 hour = extra 5%)
    if (criteria.timingHours <= 1) {
      score = score.plus(parseDecimal('0.05'));
    }
  }

  // Address match bonus (10% weight)
  if (criteria.addressMatch === true) {
    score = score.plus(0.1);
  } else if (criteria.addressMatch === false) {
    // Addresses don't match - significant penalty
    return parseDecimal('0');
  }

  // Clamp to [0, 1]
  score = Decimal.min(Decimal.max(score, parseDecimal('0')), parseDecimal('1'));

  // Round to 6 decimal places to ensure deterministic threshold comparisons
  // and avoid floating point precision issues. This precision is more than
  // sufficient for financial matching (effective similarity precision: ~2.5 ppm)
  return score.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
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
  const assetMatch = source.assetSymbol === target.assetSymbol;
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
 * Score and filter matches for a source transaction from a list of target candidates.
 *
 * Evaluates all targets against the source using hard filters (asset, direction, timing,
 * amount similarity, confidence), handles hash-match fast-path for blockchain transactions,
 * and returns matches sorted by confidence (highest first).
 *
 * @param source - Source transaction (withdrawal/send)
 * @param targets - List of target candidates (deposits/receives)
 * @param config - Matching configuration
 * @returns Array of potential matches sorted by confidence (highest first)
 */
export function scoreAndFilterMatches(
  source: TransactionCandidate,
  targets: TransactionCandidate[],
  config: MatchingConfig
): PotentialMatch[] {
  const matches: PotentialMatch[] = [];

  for (const target of targets) {
    // Prevent self-matching (candidates from the same transaction)
    if (source.id === target.id) continue;

    // Quick filters
    if (source.assetSymbol !== target.assetSymbol) continue;
    if (source.direction !== 'out' || target.direction !== 'in') continue;

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
        if (t.id === source.id) return false; // Exclude self
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
            sourceTransaction: source,
            targetTransaction: target,
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
          sourceTransaction: source,
          targetTransaction: target,
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

    // Enforce minimum amount similarity as a hard threshold
    if (criteria.amountSimilarity.lessThan(config.minAmountSimilarity)) {
      continue;
    }

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

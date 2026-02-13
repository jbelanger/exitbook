import type { SourceType, UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type {
  LinkType,
  MatchCriteria,
  MatchingConfig,
  OutflowGrouping,
  PotentialMatch,
  TransactionCandidate,
  TransactionLink,
} from './types.js';

/**
 * Default matching configuration
 */
export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  maxTimingWindowHours: 48,
  minAmountSimilarity: parseDecimal('0.95'),
  minConfidenceScore: parseDecimal('0.7'),
  autoConfirmThreshold: parseDecimal('0.95'),
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
    // Prevent self-matching (candidates from the same transaction)
    if (source.id === target.id) continue;

    // Quick filters
    if (source.assetSymbol !== target.assetSymbol) continue;
    if (source.direction !== 'out' || target.direction !== 'in') continue;

    // Check for transaction hash match (perfect match)
    // Skip hash matching for blockchain→blockchain (internal linking handles those)
    const hashMatch = checkTransactionHashMatch(source, target);
    const bothAreBlockchain = source.sourceType === 'blockchain' && target.sourceType === 'blockchain';

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

        // Exclude blockchain→blockchain (same as bothAreBlockchain check)
        const targetIsBlockchain = t.sourceType === 'blockchain';
        if (source.sourceType === 'blockchain' && targetIsBlockchain) return false;

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
 * Validate link amounts to ensure transfers are valid
 *
 * Rejects invalid scenarios:
 * - Target amount > source amount (airdrop/bonus scenario)
 * - Excessive variance >10% (likely not a valid transfer)
 *
 * @param sourceAmount - Gross outflow amount from source transaction
 * @param targetAmount - Net received amount at target transaction
 * @returns Result indicating validation success or error
 */
export function validateLinkAmounts(sourceAmount: Decimal, targetAmount: Decimal): Result<void, Error> {
  // Reject zero or negative source amounts (invalid/legacy data)
  if (sourceAmount.lte(0)) {
    return err(
      new Error(
        `Source amount must be positive, got ${sourceAmount.toFixed()}. ` +
          `This may indicate missing movement data or legacy records without amount fields.`
      )
    );
  }

  // Reject zero or negative target amounts
  if (targetAmount.lte(0)) {
    return err(
      new Error(
        `Target amount must be positive, got ${targetAmount.toFixed()}. ` + `This indicates invalid transaction data.`
      )
    );
  }

  // Reject target > source (airdrop, bonus, or data error)
  if (targetAmount.gt(sourceAmount)) {
    return err(
      new Error(
        `Target amount (${targetAmount.toFixed()}) exceeds source amount (${sourceAmount.toFixed()}). ` +
          `This link will be rejected. If this is an airdrop or bonus, create a separate transaction for the additional funds received.`
      )
    );
  }

  // Calculate variance percentage
  const variance = sourceAmount.minus(targetAmount);
  const variancePct = variance.div(sourceAmount).times(100);

  // Reject excessive variance (>10%)
  if (variancePct.gt(10)) {
    return err(
      new Error(
        `Variance (${variancePct.toFixed(2)}%) exceeds 10% threshold. ` +
          `Source: ${sourceAmount.toFixed()}, Target: ${targetAmount.toFixed()}. ` +
          `Verify amounts are correct or adjust link.`
      )
    );
  }

  return ok(undefined);
}

/**
 * Calculate variance metadata for a link
 *
 * Useful for storing debugging information in link metadata
 *
 * @param sourceAmount - Gross outflow amount
 * @param targetAmount - Net received amount
 * @returns Variance metadata object
 */
export function calculateVarianceMetadata(
  sourceAmount: Decimal,
  targetAmount: Decimal
): {
  impliedFee: string;
  variance: string;
  variancePct: string;
} {
  const variance = sourceAmount.minus(targetAmount);
  const variancePct = sourceAmount.isZero() ? parseDecimal('0') : variance.div(sourceAmount).times(100);

  return {
    variance: variance.toFixed(),
    variancePct: variancePct.toFixed(2),
    impliedFee: variance.toFixed(),
  };
}

const MAX_HASH_MATCH_TARGET_EXCESS_PCT = parseDecimal('1'); // Allow up to 1% target excess for hash matches (UTXO partial inputs)

interface LinkAmountValidationInfo {
  allowTargetExcess?:
    | {
        excess: Decimal;
        excessPct: Decimal;
      }
    | undefined;
}

/**
 * Validate link amounts with match context for hash matches.
 *
 * Allows small target>source variance when hashMatch is true (UTXO per-address data gaps).
 */
export function validateLinkAmountsForMatch(match: PotentialMatch): Result<LinkAmountValidationInfo, Error> {
  const sourceAmount = match.sourceTransaction.amount;
  const targetAmount = match.targetTransaction.amount;

  const baseValidation = validateLinkAmounts(sourceAmount, targetAmount);
  if (baseValidation.isOk()) {
    return ok({});
  }

  if (sourceAmount.lte(0) || targetAmount.lte(0)) {
    return err(baseValidation.error);
  }

  // Only consider override when target exceeds source and hash match is true
  if (!targetAmount.gt(sourceAmount)) {
    return err(baseValidation.error);
  }

  if (match.matchCriteria.hashMatch !== true) {
    return err(baseValidation.error);
  }

  const excess = targetAmount.minus(sourceAmount);
  const excessPct = excess.div(sourceAmount).times(100);

  if (excessPct.gt(MAX_HASH_MATCH_TARGET_EXCESS_PCT)) {
    return err(baseValidation.error);
  }

  return ok({
    allowTargetExcess: {
      excess,
      excessPct,
    },
  });
}

/**
 * Aggregate inflow and outflow amounts by transaction and asset for a group.
 *
 * @param group - Transactions connected by blockchain_internal links
 * @returns Aggregated amounts and asset symbols
 */
export function aggregateMovementsByTransaction(group: UniversalTransactionData[]): {
  assetIds: Set<string>;
  inflowAmountsByTx: Map<number, Map<string, Decimal>>;
  outflowAmountsByTx: Map<number, Map<string, Decimal>>;
} {
  const inflowAmountsByTx = new Map<number, Map<string, Decimal>>();
  const outflowAmountsByTx = new Map<number, Map<string, Decimal>>();
  const assetIds = new Set<string>();

  for (const tx of group) {
    const inflowMap = new Map<string, Decimal>();
    const outflowMap = new Map<string, Decimal>();

    for (const inflow of tx.movements.inflows ?? []) {
      const amount = parseDecimal(inflow.netAmount ?? inflow.grossAmount);
      const current = inflowMap.get(inflow.assetId) ?? parseDecimal('0');
      inflowMap.set(inflow.assetId, current.plus(amount));
      assetIds.add(inflow.assetId);
    }

    for (const outflow of tx.movements.outflows ?? []) {
      const amount = parseDecimal(outflow.netAmount ?? outflow.grossAmount);
      const current = outflowMap.get(outflow.assetId) ?? parseDecimal('0');
      outflowMap.set(outflow.assetId, current.plus(amount));
      assetIds.add(outflow.assetId);
    }

    if (inflowMap.size > 0) inflowAmountsByTx.set(tx.id, inflowMap);
    if (outflowMap.size > 0) outflowAmountsByTx.set(tx.id, outflowMap);
  }

  return { inflowAmountsByTx, outflowAmountsByTx, assetIds };
}

/**
 * Calculate adjusted outflow amount for an asset by subtracting internal inflows and deduped fees.
 *
 * When a blockchain_internal cluster contains multiple wallet addresses involved in
 * related transactions, outflows may include internal transfers to other owned addresses.
 * This function identifies and subtracts those internal inflows to get the actual
 * external transfer amount for matching purposes.
 *
 * NOTE: This only works when the processor creates separate transaction rows for each
 * address (per-address model). If a processor records change within the same row,
 * this adjustment won't apply.
 *
 * When multiple outflows exist for the same asset, sums all outflows to represent
 * the full external transfer for matching.
 *
 * @param assetSymbol - Asset to calculate adjustment for
 * @param group - Transactions connected by blockchain_internal links
 * @param inflowAmountsByTx - Aggregated inflow amounts
 * @param outflowAmountsByTx - Aggregated outflow amounts
 * @returns Transaction ID, adjusted amount, ambiguity flag, and all group member IDs; or skip reason
 */
export function calculateOutflowAdjustment(
  assetId: string,
  group: UniversalTransactionData[],
  inflowAmountsByTx: Map<number, Map<string, Decimal>>,
  outflowAmountsByTx: Map<number, Map<string, Decimal>>
):
  | { adjustedAmount: Decimal; groupMemberIds: number[]; multipleOutflows: boolean; representativeTxId: number }
  | { skip: 'non-positive' | 'no-adjustment' } {
  const outflowTxs = group.filter((tx) => {
    const outflowMap = outflowAmountsByTx.get(tx.id);
    if (!outflowMap) return false;
    const amount = outflowMap.get(assetId);
    return amount ? amount.gt(0) : false;
  });

  const inflowTxs = group.filter((tx) => {
    const inflowMap = inflowAmountsByTx.get(tx.id);
    if (!inflowMap) return false;
    const amount = inflowMap.get(assetId);
    return amount ? amount.gt(0) : false;
  });

  if (outflowTxs.length === 0) return { skip: 'no-adjustment' };

  const multipleOutflows = outflowTxs.length > 1;
  if (inflowTxs.length === 0 && !multipleOutflows) return { skip: 'no-adjustment' };

  const sumGrossMovements = (movements: { assetId: string; grossAmount: Decimal }[] | undefined): Decimal => {
    let total = parseDecimal('0');
    for (const movement of movements ?? []) {
      if (movement.assetId !== assetId) continue;
      total = total.plus(parseDecimal(movement.grossAmount));
    }
    return total;
  };

  // For UTXO chains with multiple inputs/outputs in the same transaction:
  // Sum ALL outflows and subtract ALL inflows (change) to get the true external transfer amount
  // Assign this total to the transaction with the smallest ID for consistency
  let totalOutflows = parseDecimal('0');
  let selectedTx = outflowTxs[0]; // Default to first tx

  for (const tx of outflowTxs) {
    const amount = sumGrossMovements(tx.movements.outflows);
    if (amount.gt(0)) {
      totalOutflows = totalOutflows.plus(amount);
      // Use smallest transaction ID for consistency
      if (!selectedTx || tx.id < selectedTx.id) {
        selectedTx = tx;
      }
    }
  }

  if (!selectedTx) return { skip: 'no-adjustment' };

  // Collect all outflow transaction IDs in this group
  // All outflows for this asset are part of the same UTXO transaction group
  const groupMemberIds: number[] = outflowTxs.map((tx) => tx.id);

  // Sum all internal inflows (change addresses)
  let totalInternalInflows = parseDecimal('0');
  for (const inflowTx of inflowTxs) {
    const amount = sumGrossMovements(inflowTx.movements.inflows);
    if (amount.gt(0)) totalInternalInflows = totalInternalInflows.plus(amount);
  }

  // Deduplicate on-chain fees (per-address processors may record fee per address)
  let feeAmount = parseDecimal('0');
  for (const tx of group) {
    for (const fee of tx.fees ?? []) {
      if (fee.assetId !== assetId) continue;
      if (fee.settlement !== 'on-chain') continue;
      const amount = parseDecimal(fee.amount);
      if (amount.gt(feeAmount)) feeAmount = amount;
    }
  }

  // Total external transfer = sum of all outflows - sum of all inflows (change)
  const adjustedAmount = totalOutflows.minus(totalInternalInflows).minus(feeAmount);
  if (adjustedAmount.lte(0)) return { skip: 'non-positive' };

  return { representativeTxId: selectedTx.id, adjustedAmount, multipleOutflows, groupMemberIds };
}

/**
 * Convert stored transactions to transaction candidates for matching.
 * Creates one candidate per asset movement (not just primary).
 * Uses netAmount for transfer matching (what actually went on-chain).
 *
 * @param transactions - Universal transactions to convert
 * @param amountOverrides - Optional map of adjusted amounts for UTXO internal change
 * @param outflowGroupings - Optional groupings of UTXO outflows (only representative gets a candidate)
 * @returns Array of transaction candidates
 */
export function convertToCandidates(
  transactions: UniversalTransactionData[],
  amountOverrides?: Map<number, Map<string, Decimal>>,
  outflowGroupings?: OutflowGrouping[]
): TransactionCandidate[] {
  const candidates: TransactionCandidate[] = [];

  // Helper to check if a transaction/asset is a non-representative group member
  const isNonRepresentativeGroupMember = (txId: number, assetId: string): boolean => {
    if (!outflowGroupings) return false;
    for (const grouping of outflowGroupings) {
      if (grouping.assetId === assetId && grouping.groupMemberIds.has(txId)) {
        // This TX is in a group - only allow the representative
        return txId !== grouping.representativeTxId;
      }
    }
    return false;
  };

  for (const tx of transactions) {
    // Create candidates for all inflows
    for (const inflow of tx.movements.inflows ?? []) {
      const candidate: TransactionCandidate = {
        id: tx.id,
        externalId: tx.externalId,
        sourceName: tx.source,
        sourceType: tx.sourceType,
        timestamp: new Date(tx.datetime),
        assetId: inflow.assetId,
        assetSymbol: inflow.assetSymbol,
        amount: inflow.netAmount ?? inflow.grossAmount,
        direction: 'in',
        fromAddress: tx.from,
        toAddress: tx.to,
        blockchainTransactionHash: tx.blockchain?.transaction_hash,
      };
      candidates.push(candidate);
    }

    // Create candidates for all outflows
    for (const outflow of tx.movements.outflows ?? []) {
      // Skip non-representative members of UTXO outflow groups
      // (their amounts are already summed into the representative's adjusted amount)
      if (isNonRepresentativeGroupMember(tx.id, outflow.assetId)) {
        continue;
      }

      const candidate: TransactionCandidate = {
        id: tx.id,
        externalId: tx.externalId,
        sourceName: tx.source,
        sourceType: tx.sourceType,
        timestamp: new Date(tx.datetime),
        assetId: outflow.assetId,
        assetSymbol: outflow.assetSymbol,
        amount: amountOverrides?.get(tx.id)?.get(outflow.assetId) ?? outflow.netAmount ?? outflow.grossAmount,
        direction: 'out',
        fromAddress: tx.from,
        toAddress: tx.to,
        blockchainTransactionHash: tx.blockchain?.transaction_hash,
      };
      candidates.push(candidate);
    }
  }

  return candidates;
}

/**
 * Separate candidates into sources (outflows) and targets (inflows)
 *
 * @param candidates - Transaction candidates
 * @returns Object with sources and targets arrays
 */
export function separateSourcesAndTargets(candidates: TransactionCandidate[]): {
  sources: TransactionCandidate[];
  targets: TransactionCandidate[];
} {
  const sources: TransactionCandidate[] = [];
  const targets: TransactionCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.direction === 'out') {
      sources.push(candidate);
    } else if (candidate.direction === 'in') {
      targets.push(candidate);
    }
  }

  return { sources, targets };
}

/**
 * Deduplicate matches and separate into confirmed vs suggested
 * - One target can only match one source (highest confidence wins)
 * - One source can only match one target (highest confidence wins)
 * - Auto-confirm matches above threshold
 *
 * @param matches - All potential matches
 * @param config - Matching configuration
 * @returns Object with confirmed and suggested matches
 */
export function deduplicateAndConfirm(
  matches: PotentialMatch[],
  config: MatchingConfig
): {
  confirmed: PotentialMatch[];
  suggested: PotentialMatch[];
} {
  // Sort all matches by confidence (highest first), with hash matches prioritized as tiebreaker
  // This ensures hash matches are processed before non-hash matches at equal confidence
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

  const usedSources = new Set<number>();
  const usedSourcesNonHash = new Set<number>();
  const usedTargets = new Set<number>();
  const deduplicatedMatches: PotentialMatch[] = [];

  // Greedily select matches, ensuring each source and target is used at most once
  // EXCEPT: Allow multiple hash matches per source (same tx hash, multiple outputs)
  for (const match of sortedMatches) {
    const sourceId = match.sourceTransaction.id;
    const targetId = match.targetTransaction.id;
    const isHashMatch = match.matchCriteria.hashMatch === true;

    // Skip if target is already used (one target can only match one source)
    if (usedTargets.has(targetId)) {
      continue;
    }

    // For non-hash matches: enforce 1:1 source matching
    // For hash matches: allow multiple per source (e.g., one blockchain tx → multiple exchange deposits)
    // But don't mix hash matches with non-hash matches for the same source
    if (!isHashMatch && usedSources.has(sourceId)) {
      continue;
    }
    if (isHashMatch && usedSourcesNonHash.has(sourceId)) {
      continue;
    }

    // Accept this match
    deduplicatedMatches.push(match);
    usedTargets.add(targetId);
    usedSources.add(sourceId);
    if (!isHashMatch) {
      usedSourcesNonHash.add(sourceId);
    }
  }

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

  return { suggested, confirmed };
}

/**
 * Create a TransactionLink object from a potential match
 *
 * Validates link amounts and includes variance metadata
 *
 * @param match - Potential match to convert
 * @param status - Link status (suggested or confirmed)
 * @param id - UUID for the link
 * @param now - Current timestamp
 * @returns Result with TransactionLink or error
 */
export function createTransactionLink(
  match: PotentialMatch,
  status: 'suggested' | 'confirmed',
  id: string,
  now: Date
): Result<TransactionLink, Error> {
  // Extract amounts from match
  const assetSymbol = match.sourceTransaction.assetSymbol;
  const sourceAmount = match.sourceTransaction.amount;
  const targetAmount = match.targetTransaction.amount;

  // Validate amounts
  const validationResult = validateLinkAmountsForMatch(match);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  // Calculate variance metadata for debugging
  const varianceMetadata = calculateVarianceMetadata(sourceAmount, targetAmount);
  const validationInfo = validationResult.value;
  const metadata = {
    ...varianceMetadata,
    ...(validationInfo.allowTargetExcess
      ? {
          targetExcessAllowed: true,
          targetExcess: validationInfo.allowTargetExcess.excess.toFixed(),
          targetExcessPct: validationInfo.allowTargetExcess.excessPct.toFixed(2),
        }
      : {}),
  };

  // Create link with all required fields
  return ok({
    id,
    sourceTransactionId: match.sourceTransaction.id,
    targetTransactionId: match.targetTransaction.id,
    assetSymbol: assetSymbol,
    sourceAssetId: match.sourceTransaction.assetId,
    targetAssetId: match.targetTransaction.assetId,
    sourceAmount,
    targetAmount,
    linkType: match.linkType,
    confidenceScore: match.confidenceScore,
    matchCriteria: match.matchCriteria,
    status,
    reviewedBy: status === 'confirmed' ? 'auto' : undefined,
    reviewedAt: status === 'confirmed' ? now : undefined,
    createdAt: now,
    updatedAt: now,
    metadata,
  });
}

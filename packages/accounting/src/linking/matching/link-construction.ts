import type { NewTransactionLink, TransactionLinkMetadata, TransactionLinkScoreBreakdownEntry } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import type { PotentialMatch } from '../shared/types.js';

const DEFAULT_MAX_SOURCE_TO_TARGET_VARIANCE_PCT = parseDecimal('10');
const MAX_HASH_MATCH_TARGET_EXCESS_PCT = parseDecimal('1'); // Allow up to 1% target excess for hash matches (UTXO partial inputs)

interface LinkAmountValidationInfo {
  allowTargetExcess?:
    | {
        excess: Decimal;
        excessPct: Decimal;
      }
    | undefined;
}

export interface LinkAmountValidationConfig {
  maxSourceToTargetVariancePct?: Decimal | undefined;
}

export interface CreateTransactionLinkOptions {
  amountValidationConfig?: LinkAmountValidationConfig | undefined;
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
function validateLinkAmounts(
  sourceAmount: Decimal,
  targetAmount: Decimal,
  config?: LinkAmountValidationConfig  
): Result<void, Error> {
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
  const maxVariancePct = config?.maxSourceToTargetVariancePct ?? DEFAULT_MAX_SOURCE_TO_TARGET_VARIANCE_PCT;

  // Reject excessive variance unless the caller explicitly allows more.
  if (variancePct.gt(maxVariancePct)) {
    return err(
      new Error(
        `Variance (${variancePct.toFixed(2)}%) exceeds ${maxVariancePct.toFixed()}% threshold. ` +
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
function calculateVarianceMetadata(
  sourceAmount: Decimal,
  targetAmount: Decimal
): {
  variance: string;
  variancePct: string;
} {
  const variance = sourceAmount.minus(targetAmount);
  const variancePct = sourceAmount.isZero() ? parseDecimal('0') : variance.div(sourceAmount).times(100);

  return {
    variance: variance.toFixed(),
    variancePct: variancePct.toFixed(2),
  };
}

function calculateImpliedFeeAmount(sourceAmount: Decimal, targetAmount: Decimal): Decimal | undefined {
  if (!sourceAmount.gt(targetAmount)) {
    return undefined;
  }

  return sourceAmount.minus(targetAmount);
}

/**
 * Validate link amounts with match context for hash matches.
 *
 * Allows small target>source variance when hashMatch is true (UTXO per-address data gaps).
 */
export function validateLinkAmountsForMatch(
  match: PotentialMatch,
  config?: LinkAmountValidationConfig  
): Result<LinkAmountValidationInfo, Error> {
  // Use consumed amount if present (partial match), otherwise original amounts
  const sourceAmount = match.consumedAmount ?? match.sourceMovement.amount;
  const targetAmount = match.consumedAmount ?? match.targetMovement.amount;

  const baseValidation = validateLinkAmounts(sourceAmount, targetAmount, config);
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
 * Create a TransactionLink object from a potential match
 *
 * Validates link amounts and includes variance metadata
 *
 * @param match - Potential match to convert
 * @param status - Link status (suggested or confirmed)
 * @param now - Current timestamp
 * @returns Result with NewTransactionLink or error
 */
export function createTransactionLink(
  match: PotentialMatch,
  status: 'suggested' | 'confirmed',
  now: Date,
  options?: CreateTransactionLinkOptions  
): Result<NewTransactionLink, Error> {
  const assetSymbol = match.sourceMovement.assetSymbol;

  // For partial matches (1:N or N:1), use consumed amount for both sides.
  // For 1:1 matches (no consumed amount), use original transaction amounts.
  const isPartialMatch = match.consumedAmount !== undefined;
  const sourceAmount = isPartialMatch ? match.consumedAmount! : match.sourceMovement.amount;
  const targetAmount = isPartialMatch ? match.consumedAmount! : match.targetMovement.amount;

  // Validate amounts
  const validationResult = validateLinkAmountsForMatch(match, options?.amountValidationConfig);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  // Build metadata
  const validationInfo = validationResult.value;
  const metadata: TransactionLinkMetadata = {};

  if (isPartialMatch) {
    // Partial match: record full original amounts for audit trail.
    // No implied fee amount — it's meaningless for splits/consolidations.
    metadata.partialMatch = true;
    metadata.fullSourceAmount = match.sourceMovement.amount.toFixed();
    metadata.fullTargetAmount = match.targetMovement.amount.toFixed();
    metadata.consumedAmount = sourceAmount.toFixed();
    metadata.transferProposalKey = buildTransferProposalKey(match);
  } else {
    // 1:1 match: variance/implied fee (original behavior, unchanged)
    const varianceMetadata = calculateVarianceMetadata(sourceAmount, targetAmount);
    Object.assign(metadata, varianceMetadata);
  }

  const impliedFeeAmount = isPartialMatch ? undefined : calculateImpliedFeeAmount(sourceAmount, targetAmount);

  if (validationInfo.allowTargetExcess) {
    metadata.targetExcessAllowed = true;
    metadata.targetExcess = validationInfo.allowTargetExcess.excess.toFixed();
    metadata.targetExcessPct = validationInfo.allowTargetExcess.excessPct.toFixed(2);
  }

  // Persist score breakdown for audit trails / debugging
  if (match.scoreBreakdown && match.scoreBreakdown.length > 0) {
    const scoreBreakdown: TransactionLinkScoreBreakdownEntry[] = match.scoreBreakdown.map((c) => ({
      signal: c.signal,
      weight: c.weight.toFixed(),
      value: c.value.toFixed(),
      contribution: c.contribution.toFixed(),
    }));
    metadata.scoreBreakdown = scoreBreakdown;
  }

  return ok({
    sourceTransactionId: match.sourceMovement.transactionId,
    targetTransactionId: match.targetMovement.transactionId,
    assetSymbol,
    sourceAssetId: match.sourceMovement.assetId,
    targetAssetId: match.targetMovement.assetId,
    sourceAmount,
    targetAmount,
    sourceMovementFingerprint: match.sourceMovement.movementFingerprint,
    targetMovementFingerprint: match.targetMovement.movementFingerprint,
    linkType: match.linkType,
    confidenceScore: match.confidenceScore,
    impliedFeeAmount,
    matchCriteria: match.matchCriteria,
    status,
    reviewedBy: status === 'confirmed' ? 'auto' : undefined,
    reviewedAt: status === 'confirmed' ? now : undefined,
    createdAt: now,
    updatedAt: now,
    metadata,
  });
}

function buildTransferProposalKey(match: PotentialMatch): string {
  const sourceFingerprint = match.sourceMovement.movementFingerprint;
  const targetFingerprint = match.targetMovement.movementFingerprint;
  const sourceAmount = match.sourceMovement.amount;
  const targetAmount = match.targetMovement.amount;

  if (sourceAmount.gt(targetAmount)) {
    return `partial-source:v1:${sourceFingerprint}`;
  }

  if (targetAmount.gt(sourceAmount)) {
    return `partial-target:v1:${targetFingerprint}`;
  }

  return `partial-pair:v1:${sourceFingerprint}:${targetFingerprint}`;
}

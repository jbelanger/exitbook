import { parseDecimal, type AssetMovementDraft, type PriceAtTxTime } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { LotTransfer } from '../../model/schemas.js';

import { getVarianceTolerance } from './lot-sorting-utils.js';

/**
 * Validate transfer variance between source and target amounts
 *
 * @returns Ok(variancePct) if within tolerance, Err() if exceeds error threshold
 */
export function validateTransferVariance(
  actualAmount: Decimal,
  expectedAmount: Decimal,
  source: string,
  txId: number,
  assetSymbol: string,
  configOverride?: { error: number; warn: number }
): Result<{ tolerance: { error: Decimal; warn: Decimal }; variancePct: Decimal }, Error> {
  const variance = actualAmount.minus(expectedAmount).abs();
  const variancePct = actualAmount.isZero() ? parseDecimal('0') : variance.dividedBy(actualAmount).times(100);

  const tolerance = getVarianceTolerance(source, configOverride);

  if (variancePct.gt(tolerance.error)) {
    return err(
      new Error(
        `Transfer amount mismatch at tx ${txId}: ` +
          `actual ${actualAmount.toFixed()} ${assetSymbol}, ` +
          `expected ${expectedAmount.toFixed()} (${variancePct.toFixed(2)}% variance, ` +
          `threshold ${tolerance.error.toFixed()}%). Likely not a valid transfer or missing fee metadata.`
      )
    );
  }

  return ok({ tolerance, variancePct });
}

/**
 * Calculate the amount to match for a transfer disposal based on fee policy
 *
 * @returns Amount to match from source lots before any separate fee disposal step
 */
export function calculateTransferDisposalAmount(
  outflow: AssetMovementDraft,
  transferredQuantity: Decimal,
  feePolicy: 'disposal' | 'add-to-basis'
): { transferDisposalQuantity: Decimal } {
  const transferDisposalQuantity = feePolicy === 'add-to-basis' ? outflow.grossAmount : transferredQuantity;

  return { transferDisposalQuantity };
}

/**
 * Build transfer metadata for same-asset transfer fees under add-to-basis policy
 */
export function calculateSameAssetFeeUsdShare(
  totalSameAssetFeeUsdValue: Decimal,
  allocationQuantity: Decimal,
  totalAmountMatched: Decimal,
  allocatedFeeUsdSoFar: Decimal,
  isFinalAllocation: boolean
): Result<Decimal, Error> {
  if (isFinalAllocation) {
    const remainingFeeUsdValue = totalSameAssetFeeUsdValue.minus(allocatedFeeUsdSoFar);
    if (remainingFeeUsdValue.lt(0)) {
      return err(
        new Error(
          `Same-asset fee allocation over-allocated by ${remainingFeeUsdValue.abs().toFixed()} USD ` +
            `while distributing ${totalSameAssetFeeUsdValue.toFixed()} USD`
        )
      );
    }

    return ok(remainingFeeUsdValue);
  }

  return ok(allocationQuantity.dividedBy(totalAmountMatched).times(totalSameAssetFeeUsdValue));
}

export function buildTransferMetadata(
  sameAssetFeeUsdShare: Decimal | undefined
): { sameAssetFeeUsdValue?: Decimal | undefined } | undefined {
  if (!sameAssetFeeUsdShare || sameAssetFeeUsdShare.isZero()) {
    return undefined;
  }

  return { sameAssetFeeUsdValue: sameAssetFeeUsdShare };
}

/**
 * Calculate inherited cost basis from lot transfers
 *
 * @returns Object with totalCostBasis, transferredQuantity, and sameAssetFeeUsdAdded
 */
export function calculateInheritedCostBasis(transfers: LotTransfer[]): {
  sameAssetFeeUsdAdded: Decimal;
  totalCostBasis: Decimal;
  transferredQuantity: Decimal;
} {
  let totalCostBasis = parseDecimal('0');
  let transferredQuantity = parseDecimal('0');
  let sameAssetFeeUsdAdded = parseDecimal('0');

  for (const transfer of transfers) {
    const basisForTransfer = transfer.costBasisPerUnit.times(transfer.quantityTransferred);
    totalCostBasis = totalCostBasis.plus(basisForTransfer);
    transferredQuantity = transferredQuantity.plus(transfer.quantityTransferred);

    if (transfer.metadata?.sameAssetFeeUsdValue) {
      const feeUsd = parseDecimal(transfer.metadata.sameAssetFeeUsdValue);
      totalCostBasis = totalCostBasis.plus(feeUsd);
      sameAssetFeeUsdAdded = sameAssetFeeUsdAdded.plus(feeUsd);
    }
  }

  return { totalCostBasis, transferredQuantity, sameAssetFeeUsdAdded };
}

/**
 * Calculate final cost basis for transfer target including fiat fees
 *
 * @param inheritedCostBasis - Cost basis from source lots
 * @param fiatFees - Fiat fees to add to cost basis
 * @param receivedQuantity - Quantity received at target
 * @returns Final cost basis per unit
 */
export function calculateTargetCostBasis(
  inheritedCostBasis: Decimal,
  fiatFees: { amount: Decimal; priceAtTxTime?: PriceAtTxTime | undefined }[],
  receivedQuantity: Decimal
): Decimal {
  let totalCostBasis = inheritedCostBasis;

  for (const fee of fiatFees) {
    if (fee.priceAtTxTime) {
      const feeUsd = fee.amount.times(fee.priceAtTxTime.price.amount);
      totalCostBasis = totalCostBasis.plus(feeUsd);
    }
  }

  return totalCostBasis.dividedBy(receivedQuantity);
}

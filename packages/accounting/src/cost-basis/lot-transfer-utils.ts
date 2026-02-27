import { parseDecimal, type AssetMovement, type PriceAtTxTime } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { getVarianceTolerance } from './lot-sorting-utils.js';
import type { LotTransfer } from './schemas.js';

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
 * @returns Amount to match and crypto fee details
 */
export function calculateTransferDisposalAmount(
  outflow: AssetMovement,
  cryptoFee: { amount: Decimal; feeType: string; priceAtTxTime?: PriceAtTxTime | undefined },
  feePolicy: 'disposal' | 'add-to-basis'
): { transferDisposalQuantity: Decimal } {
  const netTransferAmount = outflow.grossAmount.minus(cryptoFee.amount);
  const transferDisposalQuantity = feePolicy === 'add-to-basis' ? outflow.grossAmount : netTransferAmount;

  return { transferDisposalQuantity };
}

/**
 * Build transfer metadata for crypto fees under add-to-basis policy
 */
export function buildTransferMetadata(
  cryptoFee: { amount: Decimal; priceAtTxTime?: PriceAtTxTime | undefined },
  feePolicy: 'disposal' | 'add-to-basis',
  lotDisposalQuantity: Decimal,
  totalAmountMatched: Decimal
): { cryptoFeeUsdValue?: Decimal | undefined } | undefined {
  if (feePolicy !== 'add-to-basis' || cryptoFee.amount.isZero()) {
    return undefined;
  }

  if (!cryptoFee.priceAtTxTime) {
    return undefined;
  }

  const cryptoFeeUsdValue = cryptoFee.amount.times(cryptoFee.priceAtTxTime.price.amount);
  const feeShare = lotDisposalQuantity.dividedBy(totalAmountMatched).times(cryptoFeeUsdValue);

  return { cryptoFeeUsdValue: feeShare };
}

/**
 * Calculate inherited cost basis from lot transfers
 *
 * @returns Object with totalCostBasis, transferredQuantity, and cryptoFeeUsdAdded
 */
export function calculateInheritedCostBasis(transfers: LotTransfer[]): {
  cryptoFeeUsdAdded: Decimal;
  totalCostBasis: Decimal;
  transferredQuantity: Decimal;
} {
  let totalCostBasis = parseDecimal('0');
  let transferredQuantity = parseDecimal('0');
  let cryptoFeeUsdAdded = parseDecimal('0');

  for (const transfer of transfers) {
    const basisForTransfer = transfer.costBasisPerUnit.times(transfer.quantityTransferred);
    totalCostBasis = totalCostBasis.plus(basisForTransfer);
    transferredQuantity = transferredQuantity.plus(transfer.quantityTransferred);

    if (transfer.metadata?.cryptoFeeUsdValue) {
      const feeUsd = parseDecimal(transfer.metadata.cryptoFeeUsdValue);
      totalCostBasis = totalCostBasis.plus(feeUsd);
      cryptoFeeUsdAdded = cryptoFeeUsdAdded.plus(feeUsd);
    }
  }

  return { totalCostBasis, transferredQuantity, cryptoFeeUsdAdded };
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

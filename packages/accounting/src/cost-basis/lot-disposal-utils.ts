import { wrapError, type AssetMovement, type UniversalTransactionData } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { calculateFeesInFiat } from './lot-fee-utils.js';
import type { AcquisitionLot, LotDisposal } from './schemas.js';
import type { ICostBasisStrategy } from './strategies/base-strategy.js';

/**
 * Calculate net proceeds from an outflow after fees
 *
 * @returns Object with proceedsPerUnit and totalFeeAmount
 */
export function calculateNetProceeds(
  transaction: UniversalTransactionData,
  outflow: AssetMovement
): Result<{ proceedsPerUnit: Decimal; totalFeeAmount: Decimal }, Error> {
  if (!outflow.priceAtTxTime) {
    return err(new Error(`Outflow missing priceAtTxTime: transaction ${transaction.id}, asset ${outflow.assetSymbol}`));
  }

  // Calculate fees attributable to this specific movement
  // Fees reduce the proceeds (you received less from the sale)
  const feeResult = calculateFeesInFiat(transaction, outflow, false);
  if (feeResult.isErr()) {
    return err(feeResult.error);
  }
  const feeAmount = feeResult.value;

  // Gross proceeds = quantity * price
  // Net proceeds per unit = (gross proceeds - fees) / quantity
  const grossProceeds = outflow.grossAmount.times(outflow.priceAtTxTime.price.amount);
  const netProceeds = grossProceeds.minus(feeAmount);
  const proceedsPerUnit = netProceeds.dividedBy(outflow.grossAmount);

  return ok({
    proceedsPerUnit,
    totalFeeAmount: feeAmount,
  });
}

/**
 * Match an outflow (disposal) to existing acquisition lots
 *
 * Pure function that returns updated lots without mutation.
 */
export function matchOutflowDisposal(
  transaction: UniversalTransactionData,
  outflow: AssetMovement,
  allLots: AcquisitionLot[],
  strategy: ICostBasisStrategy
): Result<{ disposals: LotDisposal[]; updatedLots: AcquisitionLot[] }, Error> {
  try {
    // Find open lots for this asset (by assetId for contract-level precision)
    const openLots = allLots.filter(
      (lot) => lot.assetId === outflow.assetId && (lot.status === 'open' || lot.status === 'partially_disposed')
    );

    // Calculate net proceeds after fees
    const proceedsResult = calculateNetProceeds(transaction, outflow);
    if (proceedsResult.isErr()) {
      return err(proceedsResult.error);
    }
    const { proceedsPerUnit } = proceedsResult.value;

    // Create disposal request
    const disposal = {
      transactionId: transaction.id,
      assetSymbol: outflow.assetSymbol,
      quantity: outflow.grossAmount,
      date: new Date(transaction.datetime),
      proceedsPerUnit,
    };

    // Use strategy to match disposal to lots
    const disposalResult = strategy.matchDisposal(disposal, openLots);
    if (disposalResult.isErr()) {
      return err(disposalResult.error);
    }
    const lotDisposals = disposalResult.value;

    // Create updated lots array (no mutation)
    const updatedLots = allLots.map((lot) => {
      const lotDisposal = lotDisposals.find((ld) => ld.lotId === lot.id);
      if (!lotDisposal) {
        return lot;
      }

      // Calculate new remaining quantity and status
      const newRemainingQuantity = lot.remainingQuantity.minus(lotDisposal.quantityDisposed);
      let newStatus: 'open' | 'partially_disposed' | 'fully_disposed' = lot.status;

      if (newRemainingQuantity.isZero()) {
        newStatus = 'fully_disposed';
      } else if (newRemainingQuantity.lt(lot.quantity)) {
        newStatus = 'partially_disposed';
      }

      return {
        ...lot,
        remainingQuantity: newRemainingQuantity,
        status: newStatus,
        updatedAt: new Date(),
      };
    });

    return ok({ disposals: lotDisposals, updatedLots });
  } catch (error) {
    return wrapError(error, 'Failed to match outflow disposal');
  }
}

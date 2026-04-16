import { parseDecimal, wrapError } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { AcquisitionLot, LotDisposal } from '../../model/schemas.js';
import type { ICostBasisStrategy } from '../strategies/base-strategy.js';

import { calculateFeesInFiat } from './lot-fee-utils.js';
import {
  getMovementAssetId,
  getMovementAssetSymbol,
  getMovementGrossQuantity,
  getMovementPriceAtTxTime,
  getRawTransaction,
  type CostBasisMovementLike,
  type CostBasisTransactionLike,
} from './lot-transaction-shapes.js';

/**
 * Calculate disposal proceeds facts from an outflow after fees.
 *
 * @returns Gross, expense, and net proceeds facts for the outflow
 */
function calculateNetProceeds(
  transaction: CostBasisTransactionLike,
  outflow: CostBasisMovementLike
): Result<{ grossProceeds: Decimal; netProceeds: Decimal; proceedsPerUnit: Decimal; sellingExpenses: Decimal }, Error> {
  const rawTransaction = getRawTransaction(transaction);
  const priceAtTxTime = getMovementPriceAtTxTime(outflow);
  const assetSymbol = getMovementAssetSymbol(outflow);
  const grossQuantity = getMovementGrossQuantity(outflow);

  if (!priceAtTxTime) {
    return err(new Error(`Outflow missing priceAtTxTime: transaction ${rawTransaction.id}, asset ${assetSymbol}`));
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
  const grossProceeds = grossQuantity.times(priceAtTxTime.price.amount);
  const netProceeds = grossProceeds.minus(feeAmount);
  const proceedsPerUnit = netProceeds.dividedBy(grossQuantity);

  return ok({
    grossProceeds,
    sellingExpenses: feeAmount,
    netProceeds,
    proceedsPerUnit,
  });
}

function applyDisposalProceedsBreakdown(
  lotDisposals: LotDisposal[],
  params: {
    grossProceedsPerUnit: Decimal;
    netProceedsPerUnit: Decimal;
    sellingExpensesPerUnit: Decimal;
  }
): LotDisposal[] {
  return lotDisposals.map((lotDisposal) => {
    const grossProceeds = lotDisposal.quantityDisposed.times(params.grossProceedsPerUnit);
    const sellingExpenses = lotDisposal.quantityDisposed.times(params.sellingExpensesPerUnit);
    const netProceeds = lotDisposal.quantityDisposed.times(params.netProceedsPerUnit);

    return {
      ...lotDisposal,
      totalProceeds: netProceeds,
      grossProceeds,
      sellingExpenses,
      netProceeds,
      gainLoss: netProceeds.minus(lotDisposal.totalCostBasis),
    };
  });
}

/**
 * Match an outflow (disposal) to existing acquisition lots
 *
 * Pure function that returns updated lots without mutation.
 */
export function matchOutflowDisposal(
  transaction: CostBasisTransactionLike,
  outflow: CostBasisMovementLike,
  allLots: AcquisitionLot[],
  strategy: ICostBasisStrategy
): Result<{ disposals: LotDisposal[]; updatedLots: AcquisitionLot[] }, Error> {
  try {
    const rawTransaction = getRawTransaction(transaction);

    // Find open lots for this asset (by assetId for contract-level precision)
    const openLots = allLots.filter(
      (lot) =>
        lot.assetId === getMovementAssetId(outflow) && (lot.status === 'open' || lot.status === 'partially_disposed')
    );

    // Calculate net proceeds after fees
    const proceedsResult = calculateNetProceeds(transaction, outflow);
    if (proceedsResult.isErr()) {
      return err(proceedsResult.error);
    }
    const priceAtTxTime = getMovementPriceAtTxTime(outflow);
    const assetSymbol = getMovementAssetSymbol(outflow);
    const grossQuantity = getMovementGrossQuantity(outflow);
    if (!priceAtTxTime) {
      return err(new Error(`Outflow missing priceAtTxTime: transaction ${rawTransaction.id}, asset ${assetSymbol}`));
    }
    const { proceedsPerUnit, sellingExpenses } = proceedsResult.value;

    // Create disposal request
    const disposal = {
      transactionId: rawTransaction.id,
      assetSymbol,
      quantity: grossQuantity,
      date: new Date(rawTransaction.datetime),
      proceedsPerUnit,
    };

    // Use strategy to match disposal to lots
    const disposalResult = strategy.matchDisposal(disposal, openLots);
    if (disposalResult.isErr()) {
      return err(disposalResult.error);
    }
    const lotDisposals = applyDisposalProceedsBreakdown(disposalResult.value, {
      grossProceedsPerUnit: priceAtTxTime.price.amount,
      netProceedsPerUnit: proceedsPerUnit,
      sellingExpensesPerUnit: grossQuantity.isZero() ? parseDecimal('0') : sellingExpenses.dividedBy(grossQuantity),
    });

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

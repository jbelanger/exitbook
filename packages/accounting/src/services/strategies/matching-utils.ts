import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import type { AcquisitionLot, LotDisposal } from '../../domain/schemas.js';

import type { DisposalRequest } from './base-strategy.js';

/**
 * Calculate holding period in days between acquisition and disposal
 */
export function calculateHoldingPeriodDays(acquisitionDate: Date, disposalDate: Date): number {
  const diffMs = disposalDate.getTime() - acquisitionDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Match a disposal to sorted acquisition lots
 *
 * This is the core matching algorithm used by both FIFO and LIFO.
 * The lots should already be sorted by the caller according to the strategy
 * (FIFO: oldest first, LIFO: newest first).
 *
 * @param disposal - The disposal to match
 * @param sortedLots - Acquisition lots sorted according to strategy
 * @returns Result containing array of lot disposals showing how the disposal was matched, or Error on failure
 */
export function matchDisposalToSortedLots(
  disposal: DisposalRequest,
  sortedLots: AcquisitionLot[]
): Result<LotDisposal[], Error> {
  const disposals: LotDisposal[] = [];
  let remainingQuantity = disposal.quantity;

  for (const lot of sortedLots) {
    if (remainingQuantity.lte(0)) {
      break;
    }

    // Skip fully disposed lots
    if (lot.remainingQuantity.lte(0)) {
      continue;
    }

    // Determine how much to dispose from this lot
    const quantityToDispose = Decimal.min(remainingQuantity, lot.remainingQuantity);

    // Calculate proceeds and cost basis
    const totalProceeds = quantityToDispose.times(disposal.proceedsPerUnit);
    const totalCostBasis = quantityToDispose.times(lot.costBasisPerUnit);
    const gainLoss = totalProceeds.minus(totalCostBasis);

    // Calculate holding period
    const holdingPeriodDays = calculateHoldingPeriodDays(lot.acquisitionDate, disposal.date);

    // Create lot disposal record
    disposals.push({
      id: uuidv4(),
      lotId: lot.id,
      disposalTransactionId: disposal.transactionId,
      quantityDisposed: quantityToDispose,
      proceedsPerUnit: disposal.proceedsPerUnit,
      totalProceeds,
      costBasisPerUnit: lot.costBasisPerUnit,
      totalCostBasis,
      gainLoss,
      disposalDate: disposal.date,
      holdingPeriodDays,
      // taxTreatmentCategory will be set by GainLossCalculator using jurisdiction rules
      taxTreatmentCategory: undefined,
      createdAt: new Date(),
      metadata: undefined,
    });

    // Reduce remaining quantity
    remainingQuantity = remainingQuantity.minus(quantityToDispose);
  }

  // If there's still remaining quantity, we have insufficient lots
  if (remainingQuantity.gt(0)) {
    return err(
      new Error(
        `Insufficient acquisition lots for disposal. Asset: ${disposal.assetSymbol}, ` +
          `Disposal quantity: ${disposal.quantity.toString()}, ` +
          `Unmatched quantity: ${remainingQuantity.toString()}`
      )
    );
  }

  return ok(disposals);
}

/**
 * Sort lots by acquisition date ascending (oldest first) - for FIFO
 */
export function sortLotsFifo(lots: AcquisitionLot[]): AcquisitionLot[] {
  return [...lots].sort((a, b) => a.acquisitionDate.getTime() - b.acquisitionDate.getTime());
}

/**
 * Sort lots by acquisition date descending (newest first) - for LIFO
 */
export function sortLotsLifo(lots: AcquisitionLot[]): AcquisitionLot[] {
  return [...lots].sort((a, b) => b.acquisitionDate.getTime() - a.acquisitionDate.getTime());
}

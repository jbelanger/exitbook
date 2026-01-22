// Import parseDecimal to ensure Decimal.js is configured with precision=28 for crypto calculations
// (Decimal.set() runs as side effect when @exitbook/core/utils/decimal-utils is loaded)
// We use parseDecimal below to prevent tree-shaking from removing this critical import
import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import type { AcquisitionLot, LotDisposal } from '../../domain/schemas.js';

import type { DisposalRequest, ICostBasisStrategy } from './base-strategy.js';
import { calculateHoldingPeriodDays } from './matching-utils.js';

/**
 * Average Cost Basis (ACB) strategy for Canadian tax compliance
 *
 * Pools all acquisition lots into a weighted average cost per unit,
 * then distributes disposals pro-rata across open lots while preserving
 * acquisition dates for future superficial loss detection.
 *
 * Algorithm:
 * 1. Calculate pooled ACB = totalBasis / totalQuantity across all open lots
 * 2. Dispose from each lot pro-rata by remainingQuantity
 * 3. Use same pooled ACB per unit for all disposals
 * 4. Last lot absorbs rounding error to ensure exact quantity match
 *
 * Only supported for Canada (CA) jurisdiction.
 */
export class AverageCostStrategy implements ICostBasisStrategy {
  getName(): 'average-cost' {
    return 'average-cost';
  }

  matchDisposal(disposal: DisposalRequest, openLots: AcquisitionLot[]): Result<LotDisposal[], Error> {
    // Early exit for zero-quantity disposals (avoid unnecessary computation)
    if (disposal.quantity.isZero()) {
      return ok([]);
    }

    // Filter to open lots with remaining quantity and sort deterministically
    // Sort by acquisitionDate (oldest first), then by id for consistency
    // This ensures remainder absorption is deterministic regardless of input order
    const eligibleOpenLots = openLots
      .filter((lot) => lot.remainingQuantity.gt(0))
      .sort((a, b) => {
        const dateCompare = a.acquisitionDate.getTime() - b.acquisitionDate.getTime();
        if (dateCompare !== 0) return dateCompare;
        return a.id.localeCompare(b.id);
      });

    // Calculate pool totals
    const totalRemainingQty = eligibleOpenLots.reduce((sum, lot) => sum.plus(lot.remainingQuantity), parseDecimal('0'));

    // Validate sufficient quantity
    if (disposal.quantity.gt(totalRemainingQty)) {
      return err(
        new Error(
          `Insufficient acquisition lots for disposal. Asset: ${disposal.assetSymbol}, ` +
            `Disposal quantity: ${disposal.quantity.toFixed()}, ` +
            `Available quantity: ${totalRemainingQty.toFixed()}, ` +
            `Shortfall: ${disposal.quantity.minus(totalRemainingQty).toFixed()}`
        )
      );
    }

    // Calculate pooled ACB per unit
    const totalBasis = eligibleOpenLots.reduce(
      (sum, lot) => sum.plus(lot.remainingQuantity.times(lot.costBasisPerUnit)),
      parseDecimal('0')
    );
    const pooledCostPerUnit = totalBasis.dividedBy(totalRemainingQty);

    // Distribute disposal pro-rata with remainder absorption
    // CRITICAL: Strict accounting with relative tolerance for legitimate Decimal rounding
    // Tolerance is based on the smaller of pool or disposal to prevent false negatives
    // Uses 1e-10 (1e-8% relative) of min(pool, disposal) with minimum of 1e-18 for small amounts
    // Decimal precision is set to 28 in @exitbook/core/utils/decimal-utils
    const toleranceBase = Decimal.min(totalRemainingQty, disposal.quantity);
    const tolerance = Decimal.max(parseDecimal('1e-18'), toleranceBase.times('1e-10'));
    const disposals: LotDisposal[] = [];
    let totalAllocated = parseDecimal('0');

    for (let i = 0; i < eligibleOpenLots.length; i++) {
      const lot = eligibleOpenLots[i]!;
      const isLastLot = i === eligibleOpenLots.length - 1;

      // Calculate quantity to dispose from this lot
      let allocatedQty: Decimal;
      if (isLastLot) {
        // Last lot gets exact remainder to ensure sum = disposal.quantity
        allocatedQty = disposal.quantity.minus(totalAllocated);

        // Allow tiny negative remainders from accumulated rounding, but fail on real over-allocation
        if (allocatedQty.lt(tolerance.neg())) {
          return err(
            new Error(
              `ACB allocation error: over-allocated by ${allocatedQty.abs().toFixed()}. ` +
                `Asset: ${disposal.assetSymbol}, Disposal: ${disposal.quantity.toFixed()}, ` +
                `Total allocated: ${totalAllocated.toFixed()}. ` +
                `This indicates a precision bug in the pro-rata algorithm.`
            )
          );
        }

        // Clamp tiny negative remainders from rounding to zero
        if (allocatedQty.lt(0)) {
          allocatedQty = parseDecimal('0');
        }

        // Allow tiny excess from rounding, but fail if significantly over capacity
        if (allocatedQty.gt(lot.remainingQuantity.plus(tolerance))) {
          return err(
            new Error(
              `ACB allocation error: last lot remainder ${allocatedQty.toFixed()} ` +
                `exceeds lot capacity ${lot.remainingQuantity.toFixed()}. ` +
                `Asset: ${disposal.assetSymbol}, Lot: ${lot.id}. ` +
                `This indicates a precision bug in the pro-rata algorithm.`
            )
          );
        }

        // Cap to lot capacity if slightly over due to rounding
        if (allocatedQty.gt(lot.remainingQuantity)) {
          allocatedQty = lot.remainingQuantity;
        }
      } else {
        // Pro-rata distribution based on lot's share of total
        const weight = lot.remainingQuantity.dividedBy(totalRemainingQty);
        allocatedQty = disposal.quantity.times(weight);

        // Allow tiny excess from rounding, but fail if significantly over capacity
        if (allocatedQty.gt(lot.remainingQuantity.plus(tolerance))) {
          return err(
            new Error(
              `ACB allocation error: pro-rata allocation ${allocatedQty.toFixed()} ` +
                `exceeds lot capacity ${lot.remainingQuantity.toFixed()} for lot ${lot.id}. ` +
                `Asset: ${disposal.assetSymbol}. ` +
                `This indicates a precision bug in the pro-rata algorithm.`
            )
          );
        }

        // Cap to lot capacity if slightly over due to rounding
        if (allocatedQty.gt(lot.remainingQuantity)) {
          allocatedQty = lot.remainingQuantity;
        }
      }

      // Update totalAllocated BEFORE skip check to keep sum consistent
      // (Even if we don't create a disposal record, we need accurate sum tracking)
      totalAllocated = totalAllocated.plus(allocatedQty);

      // Skip zero-quantity disposal records (can occur from dust rounding)
      // Note: We already updated totalAllocated above for accounting consistency
      if (allocatedQty.isZero()) {
        continue;
      }

      // Calculate proceeds and cost basis using pooled ACB
      const totalProceeds = allocatedQty.times(disposal.proceedsPerUnit);
      const totalCostBasis = allocatedQty.times(pooledCostPerUnit);
      const gainLoss = totalProceeds.minus(totalCostBasis);

      // Calculate holding period (preserved from original lot)
      const holdingPeriodDays = calculateHoldingPeriodDays(lot.acquisitionDate, disposal.date);

      // Create lot disposal record
      disposals.push({
        id: uuidv4(),
        lotId: lot.id,
        disposalTransactionId: disposal.transactionId,
        quantityDisposed: allocatedQty,
        proceedsPerUnit: disposal.proceedsPerUnit,
        totalProceeds,
        costBasisPerUnit: pooledCostPerUnit, // Same for all disposals
        totalCostBasis,
        gainLoss,
        disposalDate: disposal.date,
        holdingPeriodDays,
        taxTreatmentCategory: undefined, // Set by GainLossCalculator
        createdAt: new Date(),
        metadata: undefined,
      });
    }

    // Final strict accounting verification with tolerance
    // Allow tiny drift from accumulated rounding, but fail on real accounting errors
    const difference = totalAllocated.minus(disposal.quantity).abs();

    if (difference.gt(tolerance)) {
      return err(
        new Error(
          `ACB allocation error: total allocated ${totalAllocated.toFixed()} ` +
            `does not equal disposal quantity ${disposal.quantity.toFixed()} ` +
            `(difference: ${difference.toFixed()}). ` +
            `Asset: ${disposal.assetSymbol}. ` +
            `This indicates a precision bug in the pro-rata algorithm.`
        )
      );
    }

    return ok(disposals);
  }
}

import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { AcquisitionLot, LotStatus } from './types.js';

/**
 * Create a new acquisition lot
 */
export function createAcquisitionLot(params: {
  acquisitionTransactionId: number;
  asset: string;
  calculationId: string;
  costBasisPerUnit: Decimal;
  id: string;
  method: AcquisitionLot['method'];
  quantity: Decimal;
  transactionDate: Date;
}): AcquisitionLot {
  const totalCostBasis = params.quantity.mul(params.costBasisPerUnit);
  const now = new Date();

  return {
    acquisitionDate: params.transactionDate,
    acquisitionTransactionId: params.acquisitionTransactionId,
    asset: params.asset,
    calculationId: params.calculationId,
    costBasisPerUnit: params.costBasisPerUnit,
    createdAt: now,
    id: params.id,
    method: params.method,
    quantity: params.quantity,
    remainingQuantity: params.quantity,
    status: 'open',
    totalCostBasis,
    updatedAt: now,
  };
}

/**
 * Update lot status based on remaining quantity
 */
export function updateLotStatus(lot: AcquisitionLot): LotStatus {
  if (lot.remainingQuantity.isZero()) {
    return 'fully_disposed';
  }
  if (lot.remainingQuantity.lessThan(lot.quantity)) {
    return 'partially_disposed';
  }
  return 'open';
}

/**
 * Reduce lot quantity by disposal amount
 */
export function disposeLot(lot: AcquisitionLot, quantityDisposed: Decimal): Result<AcquisitionLot, Error> {
  const remainingQuantity = lot.remainingQuantity.minus(quantityDisposed);

  if (remainingQuantity.isNegative()) {
    return err(
      new Error(
        `Cannot dispose ${quantityDisposed.toString()} from lot ${lot.id} with only ${lot.remainingQuantity.toString()} remaining`
      )
    );
  }

  const updatedLot: AcquisitionLot = {
    ...lot,
    remainingQuantity,
    updatedAt: new Date(),
  };

  return ok({
    ...updatedLot,
    status: updateLotStatus(updatedLot),
  });
}

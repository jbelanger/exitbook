import { err, ok, parseDecimal, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AcquisitionLot } from './schemas.js';

export function buildLotQuantityUpdateMap(
  lotId: string,
  quantity: Decimal,
  updatesByLotId: Map<string, Decimal>
): void {
  const existing = updatesByLotId.get(lotId) ?? parseDecimal('0');
  updatesByLotId.set(lotId, existing.plus(quantity));
}

export function applyLotQuantityUpdates(
  lots: AcquisitionLot[],
  quantityToSubtractByLotId: Map<string, Decimal>
): Result<AcquisitionLot[], Error> {
  const updatedLots: AcquisitionLot[] = [];

  for (const lot of lots) {
    const quantityToSubtract = quantityToSubtractByLotId.get(lot.id);
    if (!quantityToSubtract) {
      updatedLots.push(lot);
      continue;
    }

    const newRemainingQuantity = lot.remainingQuantity.minus(quantityToSubtract);
    if (newRemainingQuantity.lt(0)) {
      return err(
        new Error(
          `Lot ${lot.id} would go negative after applying quantity updates: ` +
            `remaining=${lot.remainingQuantity.toFixed()}, subtract=${quantityToSubtract.toFixed()}, ` +
            `newRemaining=${newRemainingQuantity.toFixed()}`
        )
      );
    }

    let newStatus: 'open' | 'partially_disposed' | 'fully_disposed' = lot.status;
    if (newRemainingQuantity.isZero()) {
      newStatus = 'fully_disposed';
    } else if (newRemainingQuantity.lt(lot.quantity)) {
      newStatus = 'partially_disposed';
    }

    updatedLots.push({
      ...lot,
      remainingQuantity: newRemainingQuantity,
      status: newStatus,
      updatedAt: new Date(),
    });
  }

  return ok(updatedLots);
}

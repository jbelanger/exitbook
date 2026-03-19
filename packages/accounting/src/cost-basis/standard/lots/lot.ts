import type { Currency } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AcquisitionLot } from '../../model/types.js';

/**
 * Create a new acquisition lot
 */
export function createAcquisitionLot(params: {
  acquisitionTransactionId: number;
  assetId: string;
  assetSymbol: Currency;
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
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
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

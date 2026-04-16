import type { AssetMovementDraft } from '@exitbook/core';
import { err, ok, randomUUID, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { AcquisitionLot } from '../../model/schemas.js';

import { calculateFeesInFiat } from './lot-fee-utils.js';
import { getRawTransaction, type CostBasisTransactionLike } from './lot-transaction-shapes.js';
import { createAcquisitionLot } from './lot.js';

/**
 * Create an acquisition lot from an inflow movement
 */
export function buildAcquisitionLotFromInflow(
  transaction: CostBasisTransactionLike,
  inflow: AssetMovementDraft,
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id'
): Result<AcquisitionLot, Error> {
  const rawTransaction = getRawTransaction(transaction);

  if (!inflow.priceAtTxTime) {
    return err(
      new Error(`Inflow missing priceAtTxTime: transaction ${rawTransaction.id}, asset ${inflow.assetSymbol}`)
    );
  }

  const quantity = inflow.grossAmount;
  const basePrice = inflow.priceAtTxTime.price.amount;

  // Calculate fees attributable to this specific movement
  // Fees increase the cost basis (you paid more to acquire the asset)
  const feeResult = calculateFeesInFiat(transaction, inflow, true);
  if (feeResult.isErr()) {
    return err(feeResult.error);
  }
  const feeAmount = feeResult.value;

  // Total cost basis = (quantity * price) + fees
  // Cost basis per unit = total cost basis / quantity
  const totalCostBasis = quantity.times(basePrice).plus(feeAmount);
  const costBasisPerUnit = totalCostBasis.dividedBy(quantity);

  return ok(
    createAcquisitionLot({
      id: randomUUID(),
      calculationId,
      acquisitionTransactionId: rawTransaction.id,
      assetId: inflow.assetId,
      assetSymbol: inflow.assetSymbol,
      quantity,
      costBasisPerUnit,
      method: strategyName,
      transactionDate: new Date(rawTransaction.datetime),
    })
  );
}

/**
 * Create an acquisition lot for an exact explained residual on a transfer target.
 *
 * This quantity is not part of the inherited transfer lot and therefore should
 * not absorb transaction-level fees from the full inflow.
 */
export function buildExplainedResidualAcquisitionLotFromInflow(
  transaction: CostBasisTransactionLike,
  inflow: AssetMovementDraft,
  quantity: Decimal,
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id'
): Result<AcquisitionLot, Error> {
  const rawTransaction = getRawTransaction(transaction);

  if (!inflow.priceAtTxTime) {
    return err(
      new Error(`Inflow missing priceAtTxTime: transaction ${rawTransaction.id}, asset ${inflow.assetSymbol}`)
    );
  }

  if (!quantity.gt(0)) {
    return err(
      new Error(
        `Explained residual acquisition quantity must be positive: transaction ${rawTransaction.id}, asset ${inflow.assetSymbol}`
      )
    );
  }

  return ok(
    createAcquisitionLot({
      id: randomUUID(),
      calculationId,
      acquisitionTransactionId: rawTransaction.id,
      assetId: inflow.assetId,
      assetSymbol: inflow.assetSymbol,
      quantity,
      costBasisPerUnit: inflow.priceAtTxTime.price.amount,
      method: strategyName,
      transactionDate: new Date(rawTransaction.datetime),
    })
  );
}

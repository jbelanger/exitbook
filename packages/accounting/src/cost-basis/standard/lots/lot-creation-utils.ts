import type { AssetMovementDraft, Transaction } from '@exitbook/core';
import { err, ok, randomUUID, type Result } from '@exitbook/foundation';

import type { AcquisitionLot } from '../../model/schemas.js';
import type { AccountingScopedTransaction } from '../matching/scoped-transaction-types.js';

import { calculateFeesInFiat } from './lot-fee-utils.js';
import { createAcquisitionLot } from './lot.js';

type CostBasisTransactionLike = AccountingScopedTransaction | Transaction;

function getRawTransaction(transaction: CostBasisTransactionLike): Transaction {
  return 'tx' in transaction ? transaction.tx : transaction;
}

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

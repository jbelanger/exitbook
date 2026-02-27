import { isFiat, type AssetMovement, type UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import { calculateFeesInFiat } from './lot-fee-utils.js';
import { createAcquisitionLot } from './lot.js';
import type { AcquisitionLot } from './schemas.js';

/**
 * Filter transactions that are missing price data on any non-fiat movements
 *
 * Fiat currencies are excluded from validation since we don't track cost basis for them.
 */
export function filterTransactionsWithoutPrices(transactions: UniversalTransactionData[]): UniversalTransactionData[] {
  return transactions.filter((tx) => {
    const inflows = tx.movements.inflows || [];
    const outflows = tx.movements.outflows || [];

    // Filter out fiat currencies - we only care about crypto asset prices
    const nonFiatInflows = inflows.filter((m) => {
      try {
        return !isFiat(m.assetSymbol);
      } catch {
        // If we can't create a Currency, assume it's crypto
        return true;
      }
    });

    const nonFiatOutflows = outflows.filter((m) => {
      try {
        return !isFiat(m.assetSymbol);
      } catch {
        // If we can't create a Currency, assume it's crypto
        return true;
      }
    });

    const inflowsWithoutPrice = nonFiatInflows.some((m) => !m.priceAtTxTime);
    const outflowsWithoutPrice = nonFiatOutflows.some((m) => !m.priceAtTxTime);
    return inflowsWithoutPrice || outflowsWithoutPrice;
  });
}

/**
 * Create an acquisition lot from an inflow movement
 */
export function buildAcquisitionLotFromInflow(
  transaction: UniversalTransactionData,
  inflow: AssetMovement,
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id' | 'average-cost'
): Result<AcquisitionLot, Error> {
  if (!inflow.priceAtTxTime) {
    return err(new Error(`Inflow missing priceAtTxTime: transaction ${transaction.id}, asset ${inflow.assetSymbol}`));
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
      id: uuidv4(),
      calculationId,
      acquisitionTransactionId: transaction.id,
      assetId: inflow.assetId,
      assetSymbol: inflow.assetSymbol,
      quantity,
      costBasisPerUnit,
      method: strategyName,
      transactionDate: new Date(transaction.datetime),
    })
  );
}

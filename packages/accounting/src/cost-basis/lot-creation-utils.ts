import { isFiat, type AssetMovement, type UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';

import type { AccountingScopedTransaction } from './build-accounting-scoped-transactions.js';
import { calculateFeesInFiat } from './lot-fee-utils.js';
import { createAcquisitionLot } from './lot.js';
import type { AcquisitionLot } from './schemas.js';

type CostBasisTransactionLike = AccountingScopedTransaction | UniversalTransactionData;

function getRawTransaction(transaction: CostBasisTransactionLike): UniversalTransactionData {
  return 'tx' in transaction ? transaction.tx : transaction;
}

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
  transaction: CostBasisTransactionLike,
  inflow: AssetMovement,
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id' | 'average-cost'
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
      id: globalThis.crypto.randomUUID(),
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

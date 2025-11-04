import { Currency, type AssetMovement, type PriceAtTxTime, type UniversalTransaction } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import { createAcquisitionLot } from '../domain/lot.js';
import type { AcquisitionLot, LotTransfer } from '../domain/schemas.js';
import type { TransactionLink } from '../linking/types.js';

/**
 * Build dependency graph from transaction links
 *
 * Creates a map where each target transaction ID points to a set of
 * source transaction IDs that must be processed before it.
 *
 * @param links - Confirmed transaction links
 * @returns Map of target transaction ID to set of source transaction IDs
 */
export function buildDependencyGraph(links: TransactionLink[]): Map<number, Set<number>> {
  const mustProcessAfter = new Map<number, Set<number>>();

  for (const link of links) {
    const existing = mustProcessAfter.get(link.targetTransactionId) ?? new Set();
    existing.add(link.sourceTransactionId);
    mustProcessAfter.set(link.targetTransactionId, existing);
  }

  return mustProcessAfter;
}

/**
 * Sort transactions with link-aware logical ordering
 *
 * Ensures linked source transactions are processed before their targets,
 * regardless of timestamps. Falls back to chronological order for unlinked
 * transactions.
 *
 * @param transactions - Transactions to sort
 * @param dependencyGraph - Map of target ID to source IDs that must come first
 * @returns Sorted transaction array
 */
export function sortWithLogicalOrdering(
  transactions: UniversalTransaction[],
  dependencyGraph: Map<number, Set<number>>
): UniversalTransaction[] {
  return [...transactions].sort((a, b) => {
    const aAfterB = dependencyGraph.get(a.id)?.has(b.id);
    const bAfterA = dependencyGraph.get(b.id)?.has(a.id);

    if (aAfterB) return 1;
    if (bAfterA) return -1;

    return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
  });
}

export function getVarianceTolerance(
  source: string,
  configOverride?: { error: number; warn: number }
): { error: Decimal; warn: Decimal } {
  const sourceTolerances: Record<string, { error: number; warn: number }> = {
    binance: { warn: 1.5, error: 5.0 },
    kucoin: { warn: 1.5, error: 5.0 },
    coinbase: { warn: 1.0, error: 3.0 },
    kraken: { warn: 0.5, error: 2.0 },
    default: { warn: 1.0, error: 3.0 },
  };

  const sourceLower = source.toLowerCase();
  const baseTolerance = sourceTolerances[sourceLower] ?? sourceTolerances.default!;
  const finalTolerance = configOverride ?? baseTolerance;

  return {
    warn: new Decimal(finalTolerance.warn),
    error: new Decimal(finalTolerance.error),
  };
}

export function extractCryptoFee(
  tx: UniversalTransaction,
  asset: string
): Result<{ amount: Decimal; feeType: string; priceAtTxTime?: PriceAtTxTime | undefined }, Error> {
  try {
    let totalAmount = new Decimal(0);
    let hasNetwork = false;
    let hasPlatform = false;
    let priceAtTxTime: PriceAtTxTime | undefined = undefined;

    // Find crypto fees in the fees array
    for (const fee of tx.fees) {
      if (fee.asset === asset) {
        totalAmount = totalAmount.plus(fee.amount);
        if (fee.scope === 'network') {
          hasNetwork = true;
        } else if (fee.scope === 'platform') {
          hasPlatform = true;
        }
        if (!priceAtTxTime) {
          priceAtTxTime = fee.priceAtTxTime;
        }
      }
    }

    let feeType: string;
    if (hasNetwork && hasPlatform) {
      feeType = 'network+platform';
    } else if (hasNetwork) {
      feeType = 'network';
    } else if (hasPlatform) {
      feeType = 'platform';
    } else {
      feeType = 'none';
    }

    return ok({
      amount: totalAmount,
      feeType,
      priceAtTxTime,
    });
  } catch (error) {
    return err(new Error(`Failed to extract crypto fee: ${error instanceof Error ? error.message : String(error)}`));
  }
}

export function collectFiatFees(
  sourceTx: UniversalTransaction,
  targetTx: UniversalTransaction
): Result<
  {
    amount: Decimal;
    asset: string;
    date: string;
    priceAtTxTime?: PriceAtTxTime | undefined;
    txId: number;
  }[],
  Error
> {
  const fiatFees: {
    amount: Decimal;
    asset: string;
    date: string;
    priceAtTxTime?: PriceAtTxTime | undefined;
    txId: number;
  }[] = [];

  for (const tx of [sourceTx, targetTx]) {
    for (const fee of tx.fees) {
      const currency = Currency.create(fee.asset);
      if (currency.isFiat()) {
        fiatFees.push({
          asset: fee.asset,
          amount: fee.amount,
          priceAtTxTime: fee.priceAtTxTime,
          txId: tx.id,
          date: tx.datetime,
        });
      }
    }
  }

  return ok(fiatFees);
}

/**
 * Filter transactions that are missing price data on any non-fiat movements
 *
 * Fiat currencies are excluded from validation since we don't track cost basis for them.
 */
export function filterTransactionsWithoutPrices(transactions: UniversalTransaction[]): UniversalTransaction[] {
  return transactions.filter((tx) => {
    const inflows = tx.movements.inflows || [];
    const outflows = tx.movements.outflows || [];

    // Filter out fiat currencies - we only care about crypto asset prices
    const nonFiatInflows = inflows.filter((m) => {
      try {
        return !Currency.create(m.asset).isFiat();
      } catch {
        // If we can't create a Currency, assume it's crypto
        return true;
      }
    });

    const nonFiatOutflows = outflows.filter((m) => {
      try {
        return !Currency.create(m.asset).isFiat();
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
 * Calculate the fiat value of fees attributable to a specific asset movement
 *
 * For INFLOWS (acquisitions):
 *   - Include ALL fees in cost basis (platform + network)
 *   - Fees increase what you paid to acquire the asset
 *
 * For OUTFLOWS (disposals):
 *   - Include only ON-CHAIN fees (settlement='on-chain')
 *   - These fees reduce your proceeds
 *   - Platform fees charged separately don't affect disposal proceeds
 *
 * @param transaction - Transaction containing fees
 * @param targetMovement - The specific movement to calculate fees for
 * @param isInflow - True for acquisitions, false for disposals
 * @returns Fee amount in fiat attributable to this movement
 */
export function calculateFeesInFiat(
  transaction: UniversalTransaction,
  targetMovement: AssetMovement,
  isInflow: boolean
): Result<Decimal, Error> {
  // Filter fees based on context
  const relevantFees = isInflow
    ? transaction.fees // Acquisitions: all fees increase cost basis
    : transaction.fees.filter((fee) => fee.settlement === 'on-chain'); // Disposals: only on-chain fees reduce proceeds

  if (relevantFees.length === 0) {
    return ok(new Decimal(0));
  }

  // If target movement IS one of the fees, don't allocate fees to it
  const isFeeMovement = relevantFees.some(
    (fee) => fee.asset === targetMovement.asset && fee.amount.equals(targetMovement.grossAmount)
  );
  if (isFeeMovement) {
    return ok(new Decimal(0));
  }

  // Calculate total fee value in fiat
  let totalFeeValue = new Decimal(0);
  for (const fee of relevantFees) {
    if (fee.priceAtTxTime) {
      const feeValue = fee.amount.times(fee.priceAtTxTime.price.amount);
      totalFeeValue = totalFeeValue.plus(feeValue);
    } else {
      // Fallback for fees without prices:
      // If fee is in fiat currency, use 1:1 conversion to target movement's price currency
      const feeCurrency = Currency.create(fee.asset);
      if (feeCurrency.isFiat() && targetMovement.priceAtTxTime) {
        const targetPriceCurrency = targetMovement.priceAtTxTime.price.currency;
        // If same currency, use 1:1. If different fiat, fail with clear error
        if (feeCurrency.equals(targetPriceCurrency)) {
          totalFeeValue = totalFeeValue.plus(fee.amount);
        } else {
          return err(
            new Error(
              `Fee in ${fee.asset} cannot be converted to ${targetPriceCurrency.toString()} without exchange rate. ` +
                `Transaction: ${transaction.id}, Fee amount: ${fee.amount.toFixed()}`
            )
          );
        }
      } else {
        // Non-fiat fee without price - this is a data integrity error
        return err(
          new Error(
            `Fee in ${fee.asset} missing priceAtTxTime. Cost basis calculation requires all crypto fees to be priced. ` +
              `Transaction: ${transaction.id}, Fee amount: ${fee.amount.toFixed()}`
          )
        );
      }
    }
  }

  // Calculate proportional allocation (unchanged from existing logic)
  const inflows = transaction.movements.inflows || [];
  const outflows = transaction.movements.outflows || [];
  const allMovements = [...inflows, ...outflows];
  const nonFiatMovements = allMovements.filter((m) => {
    try {
      return !Currency.create(m.asset).isFiat();
    } catch {
      return true;
    }
  });

  // Use grossAmount for acquisitions (what you paid), netAmount for disposals (what you received)
  const targetAmount = isInflow ? targetMovement.grossAmount : targetMovement.netAmount;
  const targetMovementValue =
    targetMovement.priceAtTxTime && targetAmount
      ? new Decimal(targetAmount).times(targetMovement.priceAtTxTime.price.amount)
      : new Decimal(0);

  let totalMovementValue = new Decimal(0);
  for (const movement of nonFiatMovements) {
    if (movement.priceAtTxTime) {
      // Use grossAmount for inflows, netAmount for outflows in proportional allocation
      const movementAmount = inflows.includes(movement) ? movement.grossAmount : movement.netAmount;
      const movementValue = movementAmount
        ? new Decimal(movementAmount).times(movement.priceAtTxTime.price.amount)
        : new Decimal(0);
      totalMovementValue = totalMovementValue.plus(movementValue);
    }
  }

  if (totalMovementValue.isZero()) {
    if (nonFiatMovements.length === 0) {
      return ok(new Decimal(0));
    }

    const targetAmountForComparison = isInflow ? targetMovement.grossAmount : targetMovement.netAmount;
    const isTargetInNonFiat = nonFiatMovements.some((m) => {
      const mAmount = inflows.includes(m) ? m.grossAmount : m.netAmount;
      return (
        m.asset === targetMovement.asset &&
        mAmount &&
        targetAmountForComparison &&
        new Decimal(mAmount).equals(new Decimal(targetAmountForComparison))
      );
    });

    if (!isTargetInNonFiat) {
      return ok(new Decimal(0));
    }

    return ok(totalFeeValue.dividedBy(nonFiatMovements.length));
  }

  // Allocate proportionally
  return ok(totalFeeValue.times(targetMovementValue).dividedBy(totalMovementValue));
}

/**
 * Group transactions by asset (from both inflows and outflows)
 */
export function groupTransactionsByAsset(transactions: UniversalTransaction[]): Map<string, UniversalTransaction[]> {
  const assetMap = new Map<string, Set<number>>();

  // Collect unique assets
  for (const tx of transactions) {
    const inflows = tx.movements.inflows || [];
    for (const inflow of inflows) {
      if (!assetMap.has(inflow.asset)) {
        assetMap.set(inflow.asset, new Set());
      }
      assetMap.get(inflow.asset)!.add(tx.id);
    }

    const outflows = tx.movements.outflows || [];
    for (const outflow of outflows) {
      if (!assetMap.has(outflow.asset)) {
        assetMap.set(outflow.asset, new Set());
      }
      assetMap.get(outflow.asset)!.add(tx.id);
    }
  }

  // Build map of asset -> transactions
  const result = new Map<string, UniversalTransaction[]>();
  for (const [asset, txIds] of assetMap) {
    const txsForAsset = transactions.filter((tx) => txIds.has(tx.id));
    result.set(asset, txsForAsset);
  }

  return result;
}

/**
 * Create an acquisition lot from an inflow movement
 */
export function buildAcquisitionLotFromInflow(
  transaction: UniversalTransaction,
  inflow: AssetMovement,
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id' | 'average-cost'
): Result<AcquisitionLot, Error> {
  if (!inflow.priceAtTxTime) {
    return err(new Error(`Inflow missing priceAtTxTime: transaction ${transaction.id}, asset ${inflow.asset}`));
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
      asset: inflow.asset,
      quantity,
      costBasisPerUnit,
      method: strategyName,
      transactionDate: new Date(transaction.datetime),
    })
  );
}

/**
 * Calculate net proceeds from an outflow after fees
 *
 * @returns Object with proceedsPerUnit and totalFeeAmount
 */
export function calculateNetProceeds(
  transaction: UniversalTransaction,
  outflow: AssetMovement
): Result<{ proceedsPerUnit: Decimal; totalFeeAmount: Decimal }, Error> {
  if (!outflow.priceAtTxTime) {
    return err(new Error(`Outflow missing priceAtTxTime: transaction ${transaction.id}, asset ${outflow.asset}`));
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
  const grossProceeds = outflow.grossAmount.times(outflow.priceAtTxTime.price.amount);
  const netProceeds = grossProceeds.minus(feeAmount);
  const proceedsPerUnit = netProceeds.dividedBy(outflow.grossAmount);

  return ok({
    proceedsPerUnit,
    totalFeeAmount: feeAmount,
  });
}

/**
 * Validate transfer variance between source and target amounts
 *
 * @returns Ok(variancePct) if within tolerance, Err() if exceeds error threshold
 */
export function validateTransferVariance(
  actualAmount: Decimal,
  expectedAmount: Decimal,
  source: string,
  txId: number,
  asset: string,
  configOverride?: { error: number; warn: number }
): Result<{ tolerance: { error: Decimal; warn: Decimal }; variancePct: Decimal }, Error> {
  const variance = actualAmount.minus(expectedAmount).abs();
  const variancePct = actualAmount.isZero() ? new Decimal(0) : variance.dividedBy(actualAmount).times(100);

  const tolerance = getVarianceTolerance(source, configOverride);

  if (variancePct.gt(tolerance.error)) {
    return err(
      new Error(
        `Transfer amount mismatch at tx ${txId}: ` +
          `actual ${actualAmount.toFixed()} ${asset}, ` +
          `expected ${expectedAmount.toFixed()} (${variancePct.toFixed(2)}% variance, ` +
          `threshold ${tolerance.error.toFixed()}%). Likely not a valid transfer or missing fee metadata.`
      )
    );
  }

  return ok({ tolerance, variancePct });
}

/**
 * Calculate the amount to match for a transfer disposal based on fee policy
 *
 * @returns Amount to match and crypto fee details
 */
export function calculateTransferDisposalAmount(
  outflow: AssetMovement,
  cryptoFee: { amount: Decimal; feeType: string; priceAtTxTime?: PriceAtTxTime | undefined },
  feePolicy: 'disposal' | 'add-to-basis'
): { amountToMatch: Decimal } {
  const netTransferAmount = outflow.grossAmount.minus(cryptoFee.amount);
  const amountToMatch = feePolicy === 'add-to-basis' ? outflow.grossAmount : netTransferAmount;

  return { amountToMatch };
}

/**
 * Build transfer metadata for crypto fees under add-to-basis policy
 */
export function buildTransferMetadata(
  cryptoFee: { amount: Decimal; priceAtTxTime?: PriceAtTxTime | undefined },
  feePolicy: 'disposal' | 'add-to-basis',
  lotDisposalQuantity: Decimal,
  totalAmountMatched: Decimal
): { cryptoFeeUsdValue?: Decimal | undefined } | undefined {
  if (feePolicy !== 'add-to-basis' || cryptoFee.amount.isZero()) {
    return undefined;
  }

  if (!cryptoFee.priceAtTxTime) {
    return undefined;
  }

  const cryptoFeeUsdValue = cryptoFee.amount.times(cryptoFee.priceAtTxTime.price.amount);
  const feeShare = lotDisposalQuantity.dividedBy(totalAmountMatched).times(cryptoFeeUsdValue);

  return { cryptoFeeUsdValue: feeShare };
}

/**
 * Calculate inherited cost basis from lot transfers
 *
 * @returns Object with totalCostBasis, transferredQuantity, and cryptoFeeUsdAdded
 */
export function calculateInheritedCostBasis(transfers: LotTransfer[]): {
  cryptoFeeUsdAdded: Decimal;
  totalCostBasis: Decimal;
  transferredQuantity: Decimal;
} {
  let totalCostBasis = new Decimal(0);
  let transferredQuantity = new Decimal(0);
  let cryptoFeeUsdAdded = new Decimal(0);

  for (const transfer of transfers) {
    const basisForTransfer = transfer.costBasisPerUnit.times(transfer.quantityTransferred);
    totalCostBasis = totalCostBasis.plus(basisForTransfer);
    transferredQuantity = transferredQuantity.plus(transfer.quantityTransferred);

    if (transfer.metadata?.cryptoFeeUsdValue) {
      const feeUsd = new Decimal(transfer.metadata.cryptoFeeUsdValue);
      totalCostBasis = totalCostBasis.plus(feeUsd);
      cryptoFeeUsdAdded = cryptoFeeUsdAdded.plus(feeUsd);
    }
  }

  return { totalCostBasis, transferredQuantity, cryptoFeeUsdAdded };
}

/**
 * Calculate final cost basis for transfer target including fiat fees
 *
 * @param inheritedCostBasis - Cost basis from source lots
 * @param fiatFees - Fiat fees to add to cost basis
 * @param receivedQuantity - Quantity received at target
 * @returns Final cost basis per unit
 */
export function calculateTargetCostBasis(
  inheritedCostBasis: Decimal,
  fiatFees: { amount: Decimal; priceAtTxTime?: PriceAtTxTime | undefined }[],
  receivedQuantity: Decimal
): Decimal {
  let totalCostBasis = inheritedCostBasis;

  for (const fee of fiatFees) {
    if (fee.priceAtTxTime) {
      const feeUsd = fee.amount.times(fee.priceAtTxTime.price.amount);
      totalCostBasis = totalCostBasis.plus(feeUsd);
    }
  }

  return totalCostBasis.dividedBy(receivedQuantity);
}

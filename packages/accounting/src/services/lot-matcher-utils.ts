import {
  Currency,
  type AssetMovement,
  type FeeMovement,
  type PriceAtTxTime,
  type UniversalTransaction,
} from '@exitbook/core';
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

/**
 * Extract only on-chain fees for a specific asset from a transaction.
 * Per ADR-005, only fees with settlement='on-chain' reduce the netAmount.
 *
 * @param tx - Transaction to extract fees from
 * @param asset - Asset to filter fees by
 * @returns Total on-chain fee amount for the asset
 */
export function extractOnChainFees(tx: UniversalTransaction, asset: string): Decimal {
  let totalOnChainFees = new Decimal(0);

  for (const fee of tx.fees) {
    if (fee.asset === asset && fee.settlement === 'on-chain') {
      totalOnChainFees = totalOnChainFees.plus(fee.amount);
    }
  }

  return totalOnChainFees;
}

/**
 * Validate that netAmount matches grossAmount minus on-chain fees.
 * Detects hidden/undeclared fees when the difference exceeds tolerance.
 *
 * Per ADR-005: netAmount = grossAmount - on-chain fees
 * Platform fees with settlement='balance' don't affect netAmount.
 *
 * @param outflow - The outflow movement to validate
 * @param tx - Transaction containing the outflow
 * @param source - Source identifier for error messages
 * @param txId - Transaction ID for error messages
 * @param configOverride - Optional variance tolerance override
 * @returns Ok if valid, Err if hidden fees exceed error threshold
 */
export function validateOutflowFees(
  outflow: AssetMovement,
  tx: UniversalTransaction,
  source: string,
  txId: number,
  configOverride?: { error: number; warn: number }
): Result<void, Error> {
  // Skip validation if netAmount is not provided (legacy data or incomplete processor)
  if (!outflow.netAmount) {
    return ok();
  }

  const grossAmount = outflow.grossAmount;
  const netAmount = outflow.netAmount;
  const onChainFees = extractOnChainFees(tx, outflow.asset);

  // Calculate expected netAmount based on declared on-chain fees
  const expectedNet = grossAmount.minus(onChainFees);

  // Calculate variance between actual and expected netAmount
  const variance = expectedNet.minus(netAmount).abs();
  const variancePct = expectedNet.isZero() ? new Decimal(0) : variance.dividedBy(expectedNet).times(100);

  const tolerance = getVarianceTolerance(source, configOverride);

  // Error if variance exceeds error threshold
  if (variancePct.gt(tolerance.error)) {
    return err(
      new Error(
        `Outflow fee validation failed at tx ${txId}: ` +
          `Detected hidden fee. ` +
          `grossAmount=${grossAmount.toFixed()} ${outflow.asset}, ` +
          `declared on-chain fees=${onChainFees.toFixed()} ${outflow.asset}, ` +
          `expected netAmount=${expectedNet.toFixed()} ${outflow.asset}, ` +
          `actual netAmount=${netAmount.toFixed()} ${outflow.asset}, ` +
          `hidden fee=${variance.toFixed()} ${outflow.asset} (${variancePct.toFixed(2)}%). ` +
          `Exceeds error threshold (${tolerance.error.toFixed()}%). ` +
          `Review exchange fee policies and ensure all fees are declared.`
      )
    );
  }

  // Warn if variance exceeds warning threshold
  if (variancePct.gt(tolerance.warn)) {
    // Just return ok - warnings are logged elsewhere
  }

  return ok();
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
 * Convert all fees to their total fiat value
 *
 * Handles fees with prices directly, and fiat fees without prices using 1:1 conversion
 * when they match the target movement's price currency.
 */
function calculateTotalFeeValueInFiat(
  fees: Pick<FeeMovement, 'amount' | 'asset' | 'priceAtTxTime'>[],
  targetMovement: AssetMovement,
  transactionId: number
): Result<Decimal, Error> {
  let totalFeeValue = new Decimal(0);

  for (const fee of fees) {
    if (fee.priceAtTxTime) {
      // Fee has price - use it directly
      const feeValue = fee.amount.times(fee.priceAtTxTime.price.amount);
      totalFeeValue = totalFeeValue.plus(feeValue);
    } else {
      // Fee has no price - try fallback conversion
      const feeCurrency = Currency.create(fee.asset);
      if (feeCurrency.isFiat() && targetMovement.priceAtTxTime) {
        const targetPriceCurrency = targetMovement.priceAtTxTime.price.currency;
        if (feeCurrency.equals(targetPriceCurrency)) {
          // Same fiat currency - use 1:1 conversion
          totalFeeValue = totalFeeValue.plus(fee.amount);
        } else {
          // Different fiat currencies - need FX rate
          return err(
            new Error(
              `Fee in ${fee.asset} cannot be converted to ${targetPriceCurrency.toString()} without exchange rate. ` +
                `Transaction: ${transactionId}, Fee amount: ${fee.amount.toFixed()}`
            )
          );
        }
      } else {
        // Non-fiat fee without price - data integrity error
        return err(
          new Error(
            `Fee in ${fee.asset} missing priceAtTxTime. Cost basis calculation requires all crypto fees to be priced. ` +
              `Transaction: ${transactionId}, Fee amount: ${fee.amount.toFixed()}`
          )
        );
      }
    }
  }

  return ok(totalFeeValue);
}

/**
 * Calculate fiat values for target movement and all non-fiat movements
 *
 * Returns the target movement's value and the sum of all non-fiat movement values.
 * Uses grossAmount for inflows and netAmount (defaulting to grossAmount) for outflows.
 */
function calculateMovementValues(
  transaction: UniversalTransaction,
  targetMovement: AssetMovement,
  isInflow: boolean
): {
  nonFiatMovements: AssetMovement[];
  targetAmount: Decimal;
  targetMovementValue: Decimal;
  totalMovementValue: Decimal;
} {
  const inflows = transaction.movements.inflows || [];
  const outflows = transaction.movements.outflows || [];
  const allMovements = [...inflows, ...outflows];

  // Filter to non-fiat movements only (we track cost basis for crypto, not fiat)
  const nonFiatMovements = allMovements.filter((m) => {
    try {
      return !Currency.create(m.asset).isFiat();
    } catch {
      return true; // If we can't determine, assume crypto
    }
  });

  // Calculate target movement amount (grossAmount for acquisitions, netAmount for disposals)
  const targetAmount = isInflow ? targetMovement.grossAmount : (targetMovement.netAmount ?? targetMovement.grossAmount);
  const targetMovementValue = targetMovement.priceAtTxTime
    ? new Decimal(targetAmount).times(targetMovement.priceAtTxTime.price.amount)
    : new Decimal(0);

  // Calculate total value of all non-fiat movements
  let totalMovementValue = new Decimal(0);
  for (const movement of nonFiatMovements) {
    if (movement.priceAtTxTime) {
      const movementAmount = inflows.includes(movement)
        ? movement.grossAmount
        : (movement.netAmount ?? movement.grossAmount);
      const movementValue = new Decimal(movementAmount).times(movement.priceAtTxTime.price.amount);
      totalMovementValue = totalMovementValue.plus(movementValue);
    }
  }

  return {
    nonFiatMovements,
    targetAmount,
    targetMovementValue,
    totalMovementValue,
  };
}

/**
 * Allocate fees proportionally across non-fiat movements
 *
 * **Standard case**: When movements have non-zero values, allocate proportionally:
 *   - Fee share = (target value / total value) × total fees
 *
 * **Edge case (zero values)**: When all movements have zero value, split evenly:
 *   - If no non-fiat movements exist, return 0
 *   - If target is not in non-fiat list, return 0 (e.g., fiat movement)
 *   - Otherwise, split equally: total fees / count of non-fiat movements
 *
 * This handles scenarios like:
 *   - Airdrops or new token launches where initial price is $0
 *   - Transactions where prices haven't been fetched yet
 *   - Fiat movements that should not receive fee allocation
 */
function allocateFeesProportionally(
  totalFeeValue: Decimal,
  values: {
    nonFiatMovements: AssetMovement[];
    targetAmount: Decimal;
    targetMovementValue: Decimal;
    totalMovementValue: Decimal;
  },
  targetMovement: AssetMovement,
  inflows: AssetMovement[]
): Decimal {
  // Standard case: proportional allocation based on value
  if (!values.totalMovementValue.isZero()) {
    return totalFeeValue.times(values.targetMovementValue).dividedBy(values.totalMovementValue);
  }

  // Edge case: all movements have zero value
  // Return 0 if no non-fiat movements to allocate to
  if (values.nonFiatMovements.length === 0) {
    return new Decimal(0);
  }

  // Check if target movement is in the non-fiat list
  // (prevents allocating fees to fiat movements)
  const isTargetInNonFiat = values.nonFiatMovements.some((m) => {
    const mAmount = inflows.includes(m) ? m.grossAmount : (m.netAmount ?? m.grossAmount);
    return m.asset === targetMovement.asset && new Decimal(mAmount).equals(new Decimal(values.targetAmount));
  });

  if (!isTargetInNonFiat) {
    return new Decimal(0);
  }

  // Split fees equally among all non-fiat movements
  return totalFeeValue.dividedBy(values.nonFiatMovements.length);
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
  const totalFeeValueResult = calculateTotalFeeValueInFiat(relevantFees, targetMovement, transaction.id);
  if (totalFeeValueResult.isErr()) {
    return err(totalFeeValueResult.error);
  }
  const totalFeeValue = totalFeeValueResult.value;

  // Calculate movement values for proportional allocation
  const values = calculateMovementValues(transaction, targetMovement, isInflow);

  // Allocate fees proportionally (or equally if all values are zero)
  const inflows = transaction.movements.inflows || [];
  const allocatedFee = allocateFeesProportionally(totalFeeValue, values, targetMovement, inflows);

  return ok(allocatedFee);
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

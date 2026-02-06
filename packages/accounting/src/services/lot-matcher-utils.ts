import type { UniversalTransactionData } from '@exitbook/core';
import { Currency, parseDecimal, type AssetMovement, type FeeMovement, type PriceAtTxTime } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import { createAcquisitionLot } from '../domain/lot.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../domain/schemas.js';
import type { TransactionLink } from '../linking/types.js';

import type { ICostBasisStrategy } from './strategies/base-strategy.js';

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
  transactions: UniversalTransactionData[],
  dependencyGraph: Map<number, Set<number>>
): UniversalTransactionData[] {
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
  const baseTolerance = sourceTolerances[sourceLower] ?? sourceTolerances['default']!;
  const finalTolerance = configOverride ?? baseTolerance;

  return {
    warn: parseDecimal(finalTolerance.warn),
    error: parseDecimal(finalTolerance.error),
  };
}

export function extractCryptoFee(
  tx: UniversalTransactionData,
  assetSymbol: string
): Result<{ amount: Decimal; feeType: string; priceAtTxTime?: PriceAtTxTime | undefined }, Error> {
  try {
    let totalAmount = parseDecimal('0');
    let hasNetwork = false;
    let hasPlatform = false;
    let priceAtTxTime: PriceAtTxTime | undefined = undefined;

    // Find crypto fees in the fees array
    for (const fee of tx.fees) {
      if (fee.assetSymbol === assetSymbol) {
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
export function extractOnChainFees(tx: UniversalTransactionData, assetSymbol: string): Decimal {
  let totalOnChainFees = parseDecimal('0');

  for (const fee of tx.fees) {
    if (fee.assetSymbol === assetSymbol && fee.settlement === 'on-chain') {
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
  tx: UniversalTransactionData,
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
  const onChainFees = extractOnChainFees(tx, outflow.assetSymbol);

  // Calculate expected netAmount based on declared on-chain fees
  const expectedNet = grossAmount.minus(onChainFees);

  // Calculate variance between actual and expected netAmount
  const variance = expectedNet.minus(netAmount).abs();
  const variancePct = expectedNet.isZero() ? parseDecimal('0') : variance.dividedBy(expectedNet).times(100);

  const tolerance = getVarianceTolerance(source, configOverride);

  // Error if variance exceeds error threshold
  if (variancePct.gt(tolerance.error)) {
    return err(
      new Error(
        `Outflow fee validation failed at tx ${txId}: ` +
          `Detected hidden fee. ` +
          `grossAmount=${grossAmount.toFixed()} ${outflow.assetSymbol}, ` +
          `declared on-chain fees=${onChainFees.toFixed()} ${outflow.assetSymbol}, ` +
          `expected netAmount=${expectedNet.toFixed()} ${outflow.assetSymbol}, ` +
          `actual netAmount=${netAmount.toFixed()} ${outflow.assetSymbol}, ` +
          `hidden fee=${variance.toFixed()} ${outflow.assetSymbol} (${variancePct.toFixed(2)}%). ` +
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
  sourceTx: UniversalTransactionData,
  targetTx: UniversalTransactionData
): Result<
  {
    amount: Decimal;
    assetSymbol: string;
    date: string;
    priceAtTxTime?: PriceAtTxTime | undefined;
    txId: number;
  }[],
  Error
> {
  const fiatFees: {
    amount: Decimal;
    assetSymbol: string;
    date: string;
    priceAtTxTime?: PriceAtTxTime | undefined;
    txId: number;
  }[] = [];

  for (const tx of [sourceTx, targetTx]) {
    for (const fee of tx.fees) {
      const currency = Currency.create(fee.assetSymbol);
      if (currency.isFiat()) {
        fiatFees.push({
          assetSymbol: fee.assetSymbol,
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
export function filterTransactionsWithoutPrices(transactions: UniversalTransactionData[]): UniversalTransactionData[] {
  return transactions.filter((tx) => {
    const inflows = tx.movements.inflows || [];
    const outflows = tx.movements.outflows || [];

    // Filter out fiat currencies - we only care about crypto asset prices
    const nonFiatInflows = inflows.filter((m) => {
      try {
        return !Currency.create(m.assetSymbol).isFiat();
      } catch {
        // If we can't create a Currency, assume it's crypto
        return true;
      }
    });

    const nonFiatOutflows = outflows.filter((m) => {
      try {
        return !Currency.create(m.assetSymbol).isFiat();
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
  fees: Pick<FeeMovement, 'amount' | 'assetSymbol' | 'priceAtTxTime'>[],
  targetMovement: AssetMovement,
  transactionId: number
): Result<Decimal, Error> {
  let totalFeeValue = parseDecimal('0');

  for (const fee of fees) {
    if (fee.priceAtTxTime) {
      // Fee has price - use it directly
      const feeValue = fee.amount.times(fee.priceAtTxTime.price.amount);
      totalFeeValue = totalFeeValue.plus(feeValue);
    } else {
      // Fee has no price - try fallback conversion
      const feeCurrency = Currency.create(fee.assetSymbol);
      if (feeCurrency.isFiat() && targetMovement.priceAtTxTime) {
        const targetPriceCurrency = targetMovement.priceAtTxTime.price.currency;
        if (feeCurrency.equals(targetPriceCurrency)) {
          // Same fiat currency - use 1:1 conversion
          totalFeeValue = totalFeeValue.plus(fee.amount);
        } else {
          // Different fiat currencies - need FX rate
          return err(
            new Error(
              `Fee in ${fee.assetSymbol} cannot be converted to ${targetPriceCurrency.toString()} without exchange rate. ` +
                `Transaction: ${transactionId}, Fee amount: ${fee.amount.toFixed()}`
            )
          );
        }
      } else {
        // Non-fiat fee without price - data integrity error
        return err(
          new Error(
            `Fee in ${fee.assetSymbol} missing priceAtTxTime. Cost basis calculation requires all crypto fees to be priced. ` +
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
  transaction: UniversalTransactionData,
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
      return !Currency.create(m.assetSymbol).isFiat();
    } catch {
      return true; // If we can't determine, assume crypto
    }
  });

  // Calculate target movement amount (grossAmount for acquisitions, netAmount for disposals)
  const targetAmount = isInflow ? targetMovement.grossAmount : (targetMovement.netAmount ?? targetMovement.grossAmount);
  const targetMovementValue = targetMovement.priceAtTxTime
    ? parseDecimal(targetAmount).times(targetMovement.priceAtTxTime.price.amount)
    : parseDecimal('0');

  // Calculate total value of all non-fiat movements
  let totalMovementValue = parseDecimal('0');
  for (const movement of nonFiatMovements) {
    if (movement.priceAtTxTime) {
      const movementAmount = inflows.includes(movement)
        ? movement.grossAmount
        : (movement.netAmount ?? movement.grossAmount);
      const movementValue = parseDecimal(movementAmount).times(movement.priceAtTxTime.price.amount);
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
    return parseDecimal('0');
  }

  // Check if target movement is in the non-fiat list
  // (prevents allocating fees to fiat movements)
  const isTargetInNonFiat = values.nonFiatMovements.some((m) => {
    const mAmount = inflows.includes(m) ? m.grossAmount : (m.netAmount ?? m.grossAmount);
    return (
      m.assetSymbol === targetMovement.assetSymbol && parseDecimal(mAmount).equals(parseDecimal(values.targetAmount))
    );
  });

  if (!isTargetInNonFiat) {
    return parseDecimal('0');
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
  transaction: UniversalTransactionData,
  targetMovement: AssetMovement,
  isInflow: boolean
): Result<Decimal, Error> {
  // Filter fees based on context
  const relevantFees = isInflow
    ? transaction.fees // Acquisitions: all fees increase cost basis
    : transaction.fees.filter((fee) => fee.settlement === 'on-chain'); // Disposals: only on-chain fees reduce proceeds

  if (relevantFees.length === 0) {
    return ok(parseDecimal('0'));
  }

  // If target movement IS one of the fees, don't allocate fees to it
  const isFeeMovement = relevantFees.some(
    (fee) => fee.assetSymbol === targetMovement.assetSymbol && fee.amount.equals(targetMovement.grossAmount)
  );
  if (isFeeMovement) {
    return ok(parseDecimal('0'));
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
export function groupTransactionsByAsset(
  transactions: UniversalTransactionData[]
): Map<string, UniversalTransactionData[]> {
  const assetMap = new Map<string, Set<number>>();

  // Collect unique assets
  for (const tx of transactions) {
    const inflows = tx.movements.inflows || [];
    for (const inflow of inflows) {
      if (!assetMap.has(inflow.assetSymbol)) {
        assetMap.set(inflow.assetSymbol, new Set());
      }
      assetMap.get(inflow.assetSymbol)!.add(tx.id);
    }

    const outflows = tx.movements.outflows || [];
    for (const outflow of outflows) {
      if (!assetMap.has(outflow.assetSymbol)) {
        assetMap.set(outflow.assetSymbol, new Set());
      }
      assetMap.get(outflow.assetSymbol)!.add(tx.id);
    }
  }

  // Build map of asset -> transactions
  const result = new Map<string, UniversalTransactionData[]>();
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
      assetSymbol: inflow.assetSymbol,
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
  transaction: UniversalTransactionData,
  outflow: AssetMovement
): Result<{ proceedsPerUnit: Decimal; totalFeeAmount: Decimal }, Error> {
  if (!outflow.priceAtTxTime) {
    return err(new Error(`Outflow missing priceAtTxTime: transaction ${transaction.id}, asset ${outflow.assetSymbol}`));
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
  assetSymbol: string,
  configOverride?: { error: number; warn: number }
): Result<{ tolerance: { error: Decimal; warn: Decimal }; variancePct: Decimal }, Error> {
  const variance = actualAmount.minus(expectedAmount).abs();
  const variancePct = actualAmount.isZero() ? parseDecimal('0') : variance.dividedBy(actualAmount).times(100);

  const tolerance = getVarianceTolerance(source, configOverride);

  if (variancePct.gt(tolerance.error)) {
    return err(
      new Error(
        `Transfer amount mismatch at tx ${txId}: ` +
          `actual ${actualAmount.toFixed()} ${assetSymbol}, ` +
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
): { transferDisposalQuantity: Decimal } {
  const netTransferAmount = outflow.grossAmount.minus(cryptoFee.amount);
  const transferDisposalQuantity = feePolicy === 'add-to-basis' ? outflow.grossAmount : netTransferAmount;

  return { transferDisposalQuantity };
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
  let totalCostBasis = parseDecimal('0');
  let transferredQuantity = parseDecimal('0');
  let cryptoFeeUsdAdded = parseDecimal('0');

  for (const transfer of transfers) {
    const basisForTransfer = transfer.costBasisPerUnit.times(transfer.quantityTransferred);
    totalCostBasis = totalCostBasis.plus(basisForTransfer);
    transferredQuantity = transferredQuantity.plus(transfer.quantityTransferred);

    if (transfer.metadata?.cryptoFeeUsdValue) {
      const feeUsd = parseDecimal(transfer.metadata.cryptoFeeUsdValue);
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

/**
 * Match an outflow (disposal) to existing acquisition lots
 *
 * Pure function that returns updated lots without mutation.
 */
export function matchOutflowDisposal(
  transaction: UniversalTransactionData,
  outflow: AssetMovement,
  allLots: AcquisitionLot[],
  strategy: ICostBasisStrategy
): Result<{ disposals: LotDisposal[]; updatedLots: AcquisitionLot[] }, Error> {
  try {
    // Find open lots for this asset
    const openLots = allLots.filter(
      (lot) => lot.assetSymbol === outflow.assetSymbol && (lot.status === 'open' || lot.status === 'partially_disposed')
    );

    // Calculate net proceeds after fees
    const proceedsResult = calculateNetProceeds(transaction, outflow);
    if (proceedsResult.isErr()) {
      return err(proceedsResult.error);
    }
    const { proceedsPerUnit } = proceedsResult.value;

    // Create disposal request
    const disposal = {
      transactionId: transaction.id,
      assetSymbol: outflow.assetSymbol,
      quantity: outflow.grossAmount,
      date: new Date(transaction.datetime),
      proceedsPerUnit,
    };

    // Use strategy to match disposal to lots
    const disposalResult = strategy.matchDisposal(disposal, openLots);
    if (disposalResult.isErr()) {
      return err(disposalResult.error);
    }
    const lotDisposals = disposalResult.value;

    // Create updated lots array (no mutation)
    const updatedLots = allLots.map((lot) => {
      const lotDisposal = lotDisposals.find((ld) => ld.lotId === lot.id);
      if (!lotDisposal) {
        return lot;
      }

      // Calculate new remaining quantity and status
      const newRemainingQuantity = lot.remainingQuantity.minus(lotDisposal.quantityDisposed);
      let newStatus: 'open' | 'partially_disposed' | 'fully_disposed' = lot.status;

      if (newRemainingQuantity.isZero()) {
        newStatus = 'fully_disposed';
      } else if (newRemainingQuantity.lt(lot.quantity)) {
        newStatus = 'partially_disposed';
      }

      return {
        ...lot,
        remainingQuantity: newRemainingQuantity,
        status: newStatus,
        updatedAt: new Date(),
      };
    });

    return ok({ disposals: lotDisposals, updatedLots });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Process a transfer source transaction
 *
 * Pure function that validates fees, creates lot transfers and disposals,
 * and returns updated lots without mutation. Returns warnings for logging.
 */
export function processTransferSource(
  tx: UniversalTransactionData,
  outflow: AssetMovement,
  link: TransactionLink,
  lots: AcquisitionLot[],
  strategy: ICostBasisStrategy,
  calculationId: string,
  jurisdiction: { sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis' },
  varianceTolerance?: { error: number; warn: number }
): Result<
  {
    disposals: LotDisposal[];
    transfers: LotTransfer[];
    updatedLots: AcquisitionLot[];
    warnings: {
      data: {
        asset?: string;
        feeAmount?: Decimal;
        linkId?: string;
        linkTargetAmount?: Decimal;
        netTransferAmount?: Decimal;
        variancePct?: Decimal;
      };
      type: 'variance' | 'missing-price';
    }[];
  },
  Error
> {
  const warnings: {
    data: {
      assetSymbol?: string;
      feeAmount?: Decimal;
      linkId?: string;
      linkTargetAmount?: Decimal;
      netTransferAmount?: Decimal;
      variancePct?: Decimal;
    };
    type: 'variance' | 'missing-price';
  }[] = [];

  const cryptoFeeResult = extractCryptoFee(tx, outflow.assetSymbol);
  if (cryptoFeeResult.isErr()) {
    return err(cryptoFeeResult.error);
  }

  const cryptoFee = cryptoFeeResult.value;

  // Validate that netAmount matches grossAmount minus on-chain fees
  const feeValidationResult = validateOutflowFees(outflow, tx, tx.source, tx.id, varianceTolerance);
  if (feeValidationResult.isErr()) {
    return err(feeValidationResult.error);
  }

  // Use netAmount for transfer validation
  const netTransferAmount = outflow.netAmount ?? outflow.grossAmount;

  // Validate transfer variance
  const varianceResult = validateTransferVariance(
    netTransferAmount,
    link.targetAmount,
    tx.source,
    tx.id,
    outflow.assetSymbol,
    varianceTolerance
  );
  if (varianceResult.isErr()) {
    return err(varianceResult.error);
  }

  const { tolerance, variancePct } = varianceResult.value;

  if (variancePct.gt(tolerance.warn)) {
    warnings.push({
      type: 'variance',
      data: {
        assetSymbol: outflow.assetSymbol,
        variancePct,
        netTransferAmount,
        linkTargetAmount: link.targetAmount,
      },
    });
  }

  const openLots = lots.filter((lot) => lot.assetSymbol === outflow.assetSymbol && lot.remainingQuantity.gt(0));

  const feePolicy = jurisdiction.sameAssetTransferFeePolicy;
  const { transferDisposalQuantity } = calculateTransferDisposalAmount(outflow, cryptoFee, feePolicy);

  const disposal = {
    transactionId: tx.id,
    assetSymbol: outflow.assetSymbol,
    quantity: transferDisposalQuantity,
    date: new Date(tx.datetime),
    proceedsPerUnit: parseDecimal('0'),
  };

  const lotDisposalsResult = strategy.matchDisposal(disposal, openLots);
  if (lotDisposalsResult.isErr()) {
    return err(lotDisposalsResult.error);
  }
  const lotDisposals = lotDisposalsResult.value;

  let cryptoFeeUsdValue: Decimal | undefined = undefined;
  if (cryptoFee.amount.gt(0) && feePolicy === 'add-to-basis') {
    if (!cryptoFee.priceAtTxTime) {
      warnings.push({
        type: 'missing-price',
        data: {
          assetSymbol: outflow.assetSymbol,
          feeAmount: cryptoFee.amount,
          linkId: link.id,
        },
      });
      cryptoFeeUsdValue = undefined;
    } else {
      cryptoFeeUsdValue = cryptoFee.amount.times(cryptoFee.priceAtTxTime.price.amount);
    }
  }

  const transfers: LotTransfer[] = [];
  const quantityToTransfer = netTransferAmount;

  // Create a map for efficient lot lookup during updates
  const lotUpdates = new Map<string, { quantityToSubtract: Decimal }>();

  for (const lotDisposal of lotDisposals) {
    // Build metadata for crypto fees if using add-to-basis policy
    const metadata = cryptoFeeUsdValue
      ? buildTransferMetadata(
          { ...cryptoFee, priceAtTxTime: cryptoFee.priceAtTxTime },
          feePolicy,
          lotDisposal.quantityDisposed,
          transferDisposalQuantity
        )
      : undefined;

    const lot = lots.find((l) => l.id === lotDisposal.lotId);
    if (!lot) {
      return err(new Error(`Lot ${lotDisposal.lotId} not found`));
    }

    transfers.push({
      id: uuidv4(),
      calculationId,
      sourceLotId: lotDisposal.lotId,
      linkId: link.id,
      quantityTransferred: lotDisposal.quantityDisposed.times(quantityToTransfer.dividedBy(transferDisposalQuantity)),
      costBasisPerUnit: lot.costBasisPerUnit,
      sourceTransactionId: tx.id,
      targetTransactionId: link.targetTransactionId,
      metadata,
      createdAt: new Date(),
    });

    // Track quantity to subtract for this lot
    const existing = lotUpdates.get(lotDisposal.lotId) || { quantityToSubtract: parseDecimal('0') };
    lotUpdates.set(lotDisposal.lotId, {
      quantityToSubtract: existing.quantityToSubtract.plus(lotDisposal.quantityDisposed),
    });
  }

  const disposals: LotDisposal[] = [];

  if (cryptoFee.amount.gt(0) && feePolicy === 'disposal') {
    const feeDisposal = {
      transactionId: tx.id,
      assetSymbol: outflow.assetSymbol,
      quantity: cryptoFee.amount,
      date: new Date(tx.datetime),
      proceedsPerUnit: cryptoFee.priceAtTxTime?.price.amount ?? parseDecimal('0'),
    };

    const feeDisposalsResult = strategy.matchDisposal(feeDisposal, openLots);
    if (feeDisposalsResult.isErr()) {
      return err(feeDisposalsResult.error);
    }
    const feeDisposals = feeDisposalsResult.value;

    for (const lotDisposal of feeDisposals) {
      const lot = lots.find((l) => l.id === lotDisposal.lotId);
      if (!lot) {
        return err(new Error(`Lot ${lotDisposal.lotId} not found`));
      }

      // Track quantity to subtract for this lot
      const existing = lotUpdates.get(lotDisposal.lotId) || { quantityToSubtract: parseDecimal('0') };
      lotUpdates.set(lotDisposal.lotId, {
        quantityToSubtract: existing.quantityToSubtract.plus(lotDisposal.quantityDisposed),
      });

      disposals.push(lotDisposal);
    }
  }

  // Create updated lots array (no mutation)
  const updatedLots = lots.map((lot) => {
    const update = lotUpdates.get(lot.id);
    if (!update) {
      return lot;
    }

    const newRemainingQuantity = lot.remainingQuantity.minus(update.quantityToSubtract);
    let newStatus: 'open' | 'partially_disposed' | 'fully_disposed' = lot.status;

    if (newRemainingQuantity.isZero()) {
      newStatus = 'fully_disposed';
    } else if (newRemainingQuantity.lt(lot.quantity)) {
      newStatus = 'partially_disposed';
    }

    return {
      ...lot,
      remainingQuantity: newRemainingQuantity,
      status: newStatus,
      updatedAt: new Date(),
    };
  });

  return ok({ disposals, transfers, updatedLots, warnings });
}

/**
 * Process a transfer target transaction to create acquisition lot with inherited cost basis
 *
 * Pure function that calculates cost basis and returns the lot with warnings for logging.
 * Source transaction must be provided (fetched by caller).
 */
export function processTransferTarget(
  tx: UniversalTransactionData,
  inflow: AssetMovement,
  link: TransactionLink,
  sourceTx: UniversalTransactionData,
  lotTransfers: LotTransfer[],
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id' | 'average-cost',
  varianceTolerance?: { error: number; warn: number }
): Result<
  {
    lot: AcquisitionLot;
    warnings: {
      data: {
        date?: string;
        feeAmount?: Decimal;
        feeAsset?: string;
        linkId?: string;
        received?: Decimal;
        sourceTxId?: number;
        targetTxId?: number;
        transferred?: Decimal;
        txId?: number;
        variancePct?: Decimal;
      };
      type: 'no-transfers' | 'variance' | 'missing-price';
    }[];
  },
  Error
> {
  const warnings: {
    data: {
      date?: string;
      feeAmount?: Decimal;
      feeAssetSymbol?: string;
      linkId?: string;
      received?: Decimal;
      sourceTxId?: number;
      targetTxId?: number;
      transferred?: Decimal;
      txId?: number;
      variancePct?: Decimal;
    };
    type: 'no-transfers' | 'variance' | 'missing-price';
  }[] = [];

  const transfers = lotTransfers.filter((t) => t.linkId === link.id);

  if (transfers.length === 0) {
    warnings.push({
      type: 'no-transfers',
      data: {
        linkId: link.id,
        targetTxId: tx.id,
        sourceTxId: link.sourceTransactionId,
      },
    });
    return err(
      new Error(
        `No lot transfers found for link ${link.id} (target tx ${tx.id}). ` +
          `Source transaction ${link.sourceTransactionId} should have been processed first.`
      )
    );
  }

  // Calculate inherited cost basis from source lots
  const { totalCostBasis: inheritedCostBasis, transferredQuantity } = calculateInheritedCostBasis(transfers);

  const receivedQuantity = inflow.grossAmount;

  // Validate transfer variance
  const varianceResult = validateTransferVariance(
    transferredQuantity,
    receivedQuantity,
    tx.source,
    tx.id,
    inflow.assetSymbol,
    varianceTolerance
  );
  if (varianceResult.isErr()) {
    return err(varianceResult.error);
  }

  const { tolerance, variancePct } = varianceResult.value;

  if (variancePct.gt(tolerance.warn)) {
    warnings.push({
      type: 'variance',
      data: {
        linkId: link.id,
        targetTxId: tx.id,
        variancePct,
        transferred: transferredQuantity,
        received: receivedQuantity,
      },
    });
  }

  const fiatFeesResult = collectFiatFees(sourceTx, tx);
  if (fiatFeesResult.isErr()) {
    return err(fiatFeesResult.error);
  }

  const fiatFees = fiatFeesResult.value;

  // Collect warnings about missing prices on fiat fees
  for (const fee of fiatFees) {
    if (!fee.priceAtTxTime) {
      warnings.push({
        type: 'missing-price',
        data: {
          txId: fee.txId,
          linkId: link.id,
          feeAssetSymbol: fee.assetSymbol,
          feeAmount: fee.amount,
          date: fee.date,
        },
      });
    }
  }

  // Calculate final cost basis including fiat fees
  const costBasisPerUnit = calculateTargetCostBasis(inheritedCostBasis, fiatFees, receivedQuantity);

  const lot = createAcquisitionLot({
    id: uuidv4(),
    calculationId,
    acquisitionTransactionId: tx.id,
    assetSymbol: inflow.assetSymbol,
    quantity: receivedQuantity,
    costBasisPerUnit,
    method: strategyName,
    transactionDate: new Date(tx.datetime),
  });

  return ok({ lot, warnings });
}

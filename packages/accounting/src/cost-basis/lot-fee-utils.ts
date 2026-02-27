import {
  isFiat,
  parseDecimal,
  type AssetMovement,
  type FeeMovement,
  type PriceAtTxTime,
  type UniversalTransactionData,
} from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { getVarianceTolerance } from './lot-sorting-utils.js';

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
      const currency = fee.assetSymbol;
      if (isFiat(currency)) {
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
      const feeCurrency = fee.assetSymbol;
      if (isFiat(feeCurrency) && targetMovement.priceAtTxTime) {
        const targetPriceCurrency = targetMovement.priceAtTxTime.price.currency;
        if (feeCurrency === targetPriceCurrency) {
          // Same fiat currency - use 1:1 conversion
          totalFeeValue = totalFeeValue.plus(fee.amount);
        } else {
          // Different fiat currencies - need FX rate
          return err(
            new Error(
              `Fee in ${fee.assetSymbol} cannot be converted to ${targetPriceCurrency} without exchange rate. ` +
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
      return !isFiat(m.assetSymbol);
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

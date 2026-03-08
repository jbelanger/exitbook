import {
  isFiat,
  parseDecimal,
  type AssetMovement,
  type FeeMovement,
  type PriceAtTxTime,
  type UniversalTransactionData,
} from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AccountingScopedTransaction } from '../matching/build-cost-basis-scoped-transactions.js';

import { getVarianceTolerance } from './lot-sorting-utils.js';

type CostBasisTransactionLike = AccountingScopedTransaction | UniversalTransactionData;

function getRawTransaction(transaction: CostBasisTransactionLike): UniversalTransactionData {
  return 'tx' in transaction ? transaction.tx : transaction;
}

function getTransactionMovements(transaction: CostBasisTransactionLike): {
  inflows: AssetMovement[];
  outflows: AssetMovement[];
} {
  return {
    inflows: transaction.movements.inflows ?? [],
    outflows: transaction.movements.outflows ?? [],
  };
}

function getTransactionFees(
  transaction: CostBasisTransactionLike
): Pick<FeeMovement, 'amount' | 'assetId' | 'assetSymbol' | 'priceAtTxTime' | 'scope' | 'settlement'>[] {
  return transaction.fees;
}

export function extractCryptoFee(
  transaction: CostBasisTransactionLike,
  assetId: string
): Result<{ amount: Decimal; feeType: string; priceAtTxTime?: PriceAtTxTime | undefined }, Error> {
  try {
    let totalAmount = parseDecimal('0');
    let hasNetwork = false;
    let hasPlatform = false;
    let priceAtTxTime: PriceAtTxTime | undefined = undefined;

    for (const fee of getTransactionFees(transaction)) {
      if (fee.assetId !== assetId) continue;

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

    let feeType = 'none';
    if (hasNetwork && hasPlatform) {
      feeType = 'network+platform';
    } else if (hasNetwork) {
      feeType = 'network';
    } else if (hasPlatform) {
      feeType = 'platform';
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
 */
export function extractOnChainFees(transaction: CostBasisTransactionLike, assetId: string): Decimal {
  let totalOnChainFees = parseDecimal('0');

  for (const fee of getTransactionFees(transaction)) {
    if (fee.assetId !== assetId || fee.settlement !== 'on-chain') {
      continue;
    }
    totalOnChainFees = totalOnChainFees.plus(fee.amount);
  }

  return totalOnChainFees;
}

/**
 * Validate that netAmount matches grossAmount minus on-chain fees.
 * Detects hidden/undeclared fees when the difference exceeds tolerance.
 */
export function validateOutflowFees(
  outflow: AssetMovement,
  transaction: CostBasisTransactionLike,
  source: string,
  txId: number,
  configOverride?: { error: number; warn: number }
): Result<void, Error> {
  if (!outflow.netAmount) {
    return ok(undefined);
  }

  const grossAmount = outflow.grossAmount;
  const netAmount = outflow.netAmount;
  const onChainFees = extractOnChainFees(transaction, outflow.assetId);
  const expectedNet = grossAmount.minus(onChainFees);
  const variance = expectedNet.minus(netAmount).abs();
  const variancePct = expectedNet.isZero() ? parseDecimal('0') : variance.dividedBy(expectedNet).times(100);

  const tolerance = getVarianceTolerance(source, configOverride);

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

  return ok(undefined);
}

export function collectFiatFees(
  sourceTx: CostBasisTransactionLike,
  targetTx: CostBasisTransactionLike,
  allocation?: {
    sourceFraction?: Decimal | undefined;
    targetFraction?: Decimal | undefined;
  }
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
  const sourceFraction = allocation?.sourceFraction ?? parseDecimal('1');
  const targetFraction = allocation?.targetFraction ?? parseDecimal('1');

  const fiatFees: {
    amount: Decimal;
    assetSymbol: string;
    date: string;
    priceAtTxTime?: PriceAtTxTime | undefined;
    txId: number;
  }[] = [];

  for (const [transaction, fraction] of [[sourceTx, sourceFraction] as const, [targetTx, targetFraction] as const]) {
    if (fraction.isZero()) continue;

    const rawTransaction = getRawTransaction(transaction);
    for (const fee of getTransactionFees(transaction)) {
      if (!isFiat(fee.assetSymbol)) continue;

      fiatFees.push({
        assetSymbol: fee.assetSymbol,
        amount: fee.amount.times(fraction),
        priceAtTxTime: fee.priceAtTxTime,
        txId: rawTransaction.id,
        date: rawTransaction.datetime,
      });
    }
  }

  return ok(fiatFees);
}

/**
 * Convert all fees to their total fiat value.
 */
function calculateTotalFeeValueInFiat(
  fees: Pick<FeeMovement, 'amount' | 'assetSymbol' | 'priceAtTxTime'>[],
  targetMovement: AssetMovement,
  transactionId: number
): Result<Decimal, Error> {
  let totalFeeValue = parseDecimal('0');

  for (const fee of fees) {
    if (fee.priceAtTxTime) {
      totalFeeValue = totalFeeValue.plus(fee.amount.times(fee.priceAtTxTime.price.amount));
      continue;
    }

    if (!isFiat(fee.assetSymbol) || !targetMovement.priceAtTxTime) {
      return err(
        new Error(
          `Fee in ${fee.assetSymbol} missing priceAtTxTime. Cost basis calculation requires all crypto fees to be priced. ` +
            `Transaction: ${transactionId}, Fee amount: ${fee.amount.toFixed()}`
        )
      );
    }

    const targetPriceCurrency = targetMovement.priceAtTxTime.price.currency;
    if (fee.assetSymbol !== targetPriceCurrency) {
      return err(
        new Error(
          `Fee in ${fee.assetSymbol} cannot be converted to ${targetPriceCurrency} without exchange rate. ` +
            `Transaction: ${transactionId}, Fee amount: ${fee.amount.toFixed()}`
        )
      );
    }

    totalFeeValue = totalFeeValue.plus(fee.amount);
  }

  return ok(totalFeeValue);
}

/**
 * Calculate fiat values for target movement and all non-fiat movements.
 */
function calculateMovementValues(
  transaction: CostBasisTransactionLike,
  targetMovement: AssetMovement,
  isInflow: boolean
): {
  nonFiatMovements: AssetMovement[];
  targetAmount: Decimal;
  targetMovementValue: Decimal;
  totalMovementValue: Decimal;
} {
  const { inflows, outflows } = getTransactionMovements(transaction);
  const allMovements = [...inflows, ...outflows];

  const nonFiatMovements = allMovements.filter((movement) => {
    try {
      return !isFiat(movement.assetSymbol);
    } catch {
      return true;
    }
  });

  const targetAmount = isInflow ? targetMovement.grossAmount : (targetMovement.netAmount ?? targetMovement.grossAmount);
  const targetMovementValue = targetMovement.priceAtTxTime
    ? targetAmount.times(targetMovement.priceAtTxTime.price.amount)
    : parseDecimal('0');

  let totalMovementValue = parseDecimal('0');
  for (const movement of nonFiatMovements) {
    if (!movement.priceAtTxTime) continue;

    const movementAmount = inflows.includes(movement)
      ? movement.grossAmount
      : (movement.netAmount ?? movement.grossAmount);
    totalMovementValue = totalMovementValue.plus(movementAmount.times(movement.priceAtTxTime.price.amount));
  }

  return {
    nonFiatMovements,
    targetAmount,
    targetMovementValue,
    totalMovementValue,
  };
}

/**
 * Allocate fees proportionally across non-fiat movements.
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
  if (!values.totalMovementValue.isZero()) {
    return totalFeeValue.times(values.targetMovementValue).dividedBy(values.totalMovementValue);
  }

  if (values.nonFiatMovements.length === 0) {
    return parseDecimal('0');
  }

  const isTargetInNonFiat = values.nonFiatMovements.some((movement) => {
    const movementAmount = inflows.includes(movement)
      ? movement.grossAmount
      : (movement.netAmount ?? movement.grossAmount);

    return movement.assetId === targetMovement.assetId && movementAmount.eq(values.targetAmount);
  });

  if (!isTargetInNonFiat) {
    return parseDecimal('0');
  }

  return totalFeeValue.dividedBy(values.nonFiatMovements.length);
}

/**
 * Calculate the fiat value of fees attributable to a specific asset movement.
 */
export function calculateFeesInFiat(
  transaction: CostBasisTransactionLike,
  targetMovement: AssetMovement,
  isInflow: boolean
): Result<Decimal, Error> {
  const relevantFees = isInflow
    ? getTransactionFees(transaction)
    : getTransactionFees(transaction).filter((fee) => fee.settlement === 'on-chain');

  if (relevantFees.length === 0) {
    return ok(parseDecimal('0'));
  }

  const isFeeMovement = relevantFees.some(
    (fee) => fee.assetId === targetMovement.assetId && fee.amount.eq(targetMovement.grossAmount)
  );
  if (isFeeMovement) {
    return ok(parseDecimal('0'));
  }

  const rawTransaction = getRawTransaction(transaction);
  const totalFeeValueResult = calculateTotalFeeValueInFiat(relevantFees, targetMovement, rawTransaction.id);
  if (totalFeeValueResult.isErr()) {
    return err(totalFeeValueResult.error);
  }

  const values = calculateMovementValues(transaction, targetMovement, isInflow);
  const inflows = getTransactionMovements(transaction).inflows;
  const allocatedFee = allocateFeesProportionally(totalFeeValueResult.value, values, targetMovement, inflows);

  return ok(allocatedFee);
}

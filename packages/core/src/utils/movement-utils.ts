import type { Decimal } from 'decimal.js';

import type { AssetMovement, MovementDirection } from '../schemas/universal-transaction.js';

import { parseDecimal } from './decimal-utils.js';

/**
 * Result of computing primary movement from inflows/outflows
 */
export interface PrimaryMovement {
  assetSymbol: string;
  amount: Decimal;
  direction: MovementDirection;
}

/**
 * Compute the primary movement from inflows and outflows.
 *
 * Priority:
 * 1. If inflows only -> primary is the largest inflow (direction: 'in')
 * 2. If outflows only -> primary is the largest outflow (direction: 'out')
 * 3. If both -> primary is the largest across all movements (inflow wins on tie)
 * 4. If empty -> undefined
 *
 * @param inflows - Array of asset inflows
 * @param outflows - Array of asset outflows
 * @returns Primary movement or undefined if no movements exist
 */
export function computePrimaryMovement(
  inflows: AssetMovement[] = [],
  outflows: AssetMovement[] = []
): PrimaryMovement | undefined {
  const hasInflows = inflows.length > 0;
  const hasOutflows = outflows.length > 0;

  // Case 6: No movements at all
  if (!hasInflows && !hasOutflows) {
    return undefined;
  }

  // Single-side cases: return the largest (handles both single and multiple)
  if (hasInflows && !hasOutflows) {
    const largestInflow = findLargestMovement(inflows);
    return {
      assetSymbol: largestInflow.assetSymbol,
      amount: largestInflow.grossAmount,
      direction: 'in',
    };
  }

  if (hasOutflows && !hasInflows) {
    const largestOutflow = findLargestMovement(outflows);
    return {
      assetSymbol: largestOutflow.assetSymbol,
      amount: largestOutflow.grossAmount,
      direction: 'out',
    };
  }

  // Both inflows and outflows exist: return the largest by amount
  const largestInflow = findLargestMovement(inflows);
  const largestOutflow = findLargestMovement(outflows);

  const inflowValue = largestInflow.grossAmount;
  const outflowValue = largestOutflow.grossAmount;

  if (inflowValue.greaterThanOrEqualTo(outflowValue)) {
    return { assetSymbol: largestInflow.assetSymbol, amount: inflowValue, direction: 'in' };
  }
  return { assetSymbol: largestOutflow.assetSymbol, amount: outflowValue, direction: 'out' };
}

/**
 * Find the largest movement in an array by amount.
 * If there's a tie, returns the first one.
 *
 * @param movements - Array of asset movements (must not be empty)
 * @returns The largest movement
 */
function findLargestMovement(movements: AssetMovement[]): AssetMovement {
  if (movements.length === 0) {
    throw new Error('Cannot find largest movement in empty array');
  }

  let largest = movements[0]!;
  let largestAmount = parseDecimal(largest.grossAmount);

  for (let i = 1; i < movements.length; i++) {
    const currentAmount = parseDecimal(movements[i]!.grossAmount);
    if (currentAmount.greaterThan(largestAmount)) {
      largest = movements[i]!;
      largestAmount = currentAmount;
    }
  }

  return largest;
}

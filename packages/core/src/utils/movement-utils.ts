import { Decimal } from 'decimal.js';

import type { AssetMovement, MovementDirection } from '../types/universal-transaction.js';

/**
 * Result of computing primary movement from inflows/outflows
 */
export interface PrimaryMovement {
  asset: string;
  amount: Decimal;
  direction: MovementDirection;
}

/**
 * Compute the primary movement from inflows and outflows.
 *
 * Priority:
 * 1. If single inflow and no outflows -> primary is the inflow (direction: 'in')
 * 2. If single outflow and no inflows -> primary is the outflow (direction: 'out')
 * 3. If multiple inflows but no outflows -> primary is largest inflow (direction: 'in')
 * 4. If multiple outflows but no inflows -> primary is largest outflow (direction: 'out')
 * 5. If both inflows and outflows exist -> primary is largest by value (direction based on which side)
 * 6. If empty -> null
 *
 * @param inflows - Array of asset inflows
 * @param outflows - Array of asset outflows
 * @returns Primary movement or null if no movements exist
 */
export function computePrimaryMovement(inflows: AssetMovement[], outflows: AssetMovement[]): PrimaryMovement | null {
  const hasInflows = inflows.length > 0;
  const hasOutflows = outflows.length > 0;

  // Case 6: No movements at all
  if (!hasInflows && !hasOutflows) {
    return null;
  }

  // Case 1: Single inflow, no outflows
  if (hasInflows && !hasOutflows && inflows.length === 1) {
    return {
      asset: inflows[0]!.asset,
      amount: inflows[0]!.amount,
      direction: 'in',
    };
  }

  // Case 2: Single outflow, no inflows
  if (hasOutflows && !hasInflows && outflows.length === 1) {
    return {
      asset: outflows[0]!.asset,
      amount: outflows[0]!.amount,
      direction: 'out',
    };
  }

  // Case 3: Multiple inflows, no outflows
  if (hasInflows && !hasOutflows) {
    const largestInflow = findLargestMovement(inflows);
    return {
      asset: largestInflow.asset,
      amount: largestInflow.amount,
      direction: 'in',
    };
  }

  // Case 4: Multiple outflows, no inflows
  if (hasOutflows && !hasInflows) {
    const largestOutflow = findLargestMovement(outflows);
    return {
      asset: largestOutflow.asset,
      amount: largestOutflow.amount,
      direction: 'out',
    };
  }

  // Case 5: Both inflows and outflows exist
  const largestInflow = findLargestMovement(inflows);
  const largestOutflow = findLargestMovement(outflows);

  const inflowValue = new Decimal(largestInflow.amount);
  const outflowValue = new Decimal(largestOutflow.amount);

  // Compare by absolute value to determine which is primary
  if (inflowValue.greaterThanOrEqualTo(outflowValue)) {
    return {
      asset: largestInflow.asset,
      amount: inflowValue,
      direction: 'in',
    };
  } else {
    return {
      asset: largestOutflow.asset,
      amount: outflowValue,
      direction: 'out',
    };
  }
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
  let largestAmount = new Decimal(largest.amount);

  for (let i = 1; i < movements.length; i++) {
    const currentAmount = new Decimal(movements[i]!.amount);
    if (currentAmount.greaterThan(largestAmount)) {
      largest = movements[i]!;
      largestAmount = currentAmount;
    }
  }

  return largest;
}

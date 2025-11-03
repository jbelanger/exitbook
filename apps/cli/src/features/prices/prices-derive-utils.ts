/**
 * Pure business logic for price derivation
 *
 * These functions implement the core derivation rules without side effects:
 * - Count movements that need prices
 * - Count total movements in transactions
 * - Filter movements by criteria (fiat vs non-fiat)
 *
 * Following "Functional Core, Imperative Shell" pattern from CLAUDE.md
 */

import { Currency, type AssetMovement, type UniversalTransaction } from '@exitbook/core';

/**
 * Count total number of movements across all transactions
 * Excludes fiat currencies as they don't need prices (they ARE the price)
 *
 * @param transactions - Array of transactions to count
 * @returns Total count of non-fiat movements
 */
export function countAllMovements(transactions: UniversalTransaction[]): number {
  let count = 0;

  for (const tx of transactions) {
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];

    for (const movement of [...inflows, ...outflows]) {
      // Skip fiat currencies - they don't need prices
      const currency = Currency.create(movement.asset);
      if (currency.isFiat()) {
        continue;
      }
      count++;
    }
  }

  return count;
}

/**
 * Count movements without prices across all transactions
 * Excludes fiat currencies as they don't need prices (they ARE the price)
 *
 * @param transactions - Array of transactions to analyze
 * @returns Count of non-fiat movements that lack price data
 */
export function countMovementsWithoutPrices(transactions: UniversalTransaction[]): number {
  let count = 0;

  for (const tx of transactions) {
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];

    for (const movement of [...inflows, ...outflows]) {
      // Skip fiat currencies - they don't need prices (they ARE the price)
      const currency = Currency.create(movement.asset);
      if (currency.isFiat()) {
        continue;
      }

      if (!movement.priceAtTxTime) {
        count++;
      }
    }
  }

  return count;
}

/**
 * Check if a movement needs price data
 * Returns false for fiat currencies (they don't need prices)
 *
 * @param movement - Movement to check
 * @returns True if movement needs a price
 */
export function movementNeedsPrice(movement: AssetMovement): boolean {
  const currency = Currency.create(movement.asset);

  // Fiat currencies don't need prices
  if (currency.isFiat()) {
    return false;
  }

  // Crypto/other assets need prices if they don't have one
  return !movement.priceAtTxTime;
}

/**
 * Count movements in a single transaction that need prices
 *
 * @param tx - Transaction to analyze
 * @returns Count of movements needing prices
 */
export function countTransactionMovementsNeedingPrices(tx: UniversalTransaction): number {
  const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? [])];

  return allMovements.filter(movementNeedsPrice).length;
}

/**
 * Get all non-fiat movements from a transaction
 *
 * @param tx - Transaction to extract from
 * @returns Array of non-fiat movements
 */
export function getNonFiatMovements(tx: UniversalTransaction): AssetMovement[] {
  const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? [])];

  return allMovements.filter((movement) => {
    const currency = Currency.create(movement.asset);
    return !currency.isFiat();
  });
}

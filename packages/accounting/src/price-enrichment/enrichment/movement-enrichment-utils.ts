/**
 * Utilities for enriching asset movements with price data
 *
 * Price source priority (highest to lowest):
 * 1. exchange-execution - Never overwrite (most authoritative)
 * 2. derived-ratio, link-propagated - Can overwrite provider prices
 * 3. provider prices (coingecko, binance, etc.)
 * 0. fiat-execution-tentative - Pending normalization to USD
 */

import type { AssetMovement, PriceAtTxTime } from '@exitbook/core';

/** Price source priority levels */
const PRICE_SOURCE_PRIORITY = {
  'exchange-execution': 3,
  'derived-ratio': 2,
  'link-propagated': 2,
  'fiat-execution-tentative': 0,
} as const;

function getPriority(source: string): number {
  return PRICE_SOURCE_PRIORITY[source as keyof typeof PRICE_SOURCE_PRIORITY] ?? 1;
}

const isDerivedSource = (source: string) => source === 'derived-ratio' || source === 'link-propagated';

/**
 * Apply price priority rules to any entity with an optional priceAtTxTime field.
 * Works with both AssetMovement and FeeMovement.
 */
export function enrichWithPrice<T extends { priceAtTxTime?: PriceAtTxTime | undefined }>(
  entity: T,
  newPrice: PriceAtTxTime
): T {
  if (!entity.priceAtTxTime) {
    return { ...entity, priceAtTxTime: newPrice };
  }

  const existingPriority = getPriority(entity.priceAtTxTime.source);
  const newPriority = getPriority(newPrice.source);

  // Higher priority always wins
  if (newPriority > existingPriority) {
    return { ...entity, priceAtTxTime: newPrice };
  }

  // Allow derived sources to refresh at same priority level
  if (
    newPriority === existingPriority &&
    isDerivedSource(newPrice.source) &&
    isDerivedSource(entity.priceAtTxTime.source)
  ) {
    return { ...entity, priceAtTxTime: newPrice };
  }

  return entity;
}

/**
 * Enrich a single movement with new price data according to priority rules.
 */
export function enrichMovementWithPrice(movement: AssetMovement, newPrice: PriceAtTxTime): AssetMovement {
  return enrichWithPrice(movement, newPrice);
}

/**
 * Enrich an array of movements with prices from a map
 *
 * @param movements - Array of movements to enrich
 * @param pricesMap - Map of asset symbol to price data
 * @returns Enriched movements array
 */
export function enrichMovementsWithPrices(
  movements: AssetMovement[],
  pricesMap: Map<string, PriceAtTxTime>
): AssetMovement[] {
  return movements.map((movement) => {
    const newPrice = pricesMap.get(movement.assetSymbol);
    if (!newPrice) {
      return movement;
    }
    return enrichMovementWithPrice(movement, newPrice);
  });
}

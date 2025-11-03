/**
 * Utilities for enriching asset movements with price data
 *
 * This module contains the business logic for price priority rules:
 * 1. exchange-execution (highest priority - never overwrite)
 * 2. derived-ratio, link-propagated (can overwrite provider prices)
 * 3. provider prices (lowest priority)
 */

import type { AssetMovement, PriceAtTxTime } from '@exitbook/core';

/**
 * Price source priority levels
 */
const PRICE_SOURCE_PRIORITY = {
  'exchange-execution': 3, // Highest - actual trade execution price (USD only)
  'derived-ratio': 2, // Medium - calculated from swap ratios, or upgraded from fiat-execution-tentative
  'link-propagated': 2, // Medium - propagated via transaction links
  // All provider sources (coingecko, binance, etc.) = 1
  'fiat-execution-tentative': 0, // Lowest - non-USD fiat trade, pending normalization to USD
} as const;

/**
 * Get priority level for a price source
 */
function getPriority(source: string): number {
  return PRICE_SOURCE_PRIORITY[source as keyof typeof PRICE_SOURCE_PRIORITY] ?? 1;
}

/**
 * Enrich a single movement with new price data according to priority rules
 *
 * Priority hierarchy (highest to lowest):
 * 1. exchange-execution - Never overwrite (most authoritative)
 * 2. derived-ratio, link-propagated - Can overwrite provider prices
 * 3. provider prices (coingecko, binance, etc.) - Lowest priority
 *
 * @param movement - The movement to enrich
 * @param newPrice - The new price data to apply
 * @returns Enriched movement (may be unchanged if existing price has higher priority)
 */
export function enrichMovementWithPrice(movement: AssetMovement, newPrice: PriceAtTxTime): AssetMovement {
  // No existing price - add the new one
  if (!movement.priceAtTxTime) {
    return {
      ...movement,
      priceAtTxTime: newPrice,
    };
  }

  // Compare priorities
  const existingPriority = getPriority(movement.priceAtTxTime.source);
  const newPriority = getPriority(newPrice.source);

  if (newPriority > existingPriority) {
    // New price has higher priority - overwrite
    return {
      ...movement,
      priceAtTxTime: newPrice,
    };
  }

  // Special case: Allow derived sources to refresh at same priority level
  // This enables re-running enrichment after improving swap math or getting fresher link data
  const isDerivedSource = (source: string) => source === 'derived-ratio' || source === 'link-propagated';

  if (
    newPriority === existingPriority &&
    isDerivedSource(newPrice.source) &&
    isDerivedSource(movement.priceAtTxTime.source)
  ) {
    return {
      ...movement,
      priceAtTxTime: newPrice,
    };
  }

  // Keep existing price (has higher priority, or same priority for non-derived sources)
  return movement;
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
    const newPrice = pricesMap.get(movement.asset);
    if (!newPrice) {
      return movement;
    }
    return enrichMovementWithPrice(movement, newPrice);
  });
}

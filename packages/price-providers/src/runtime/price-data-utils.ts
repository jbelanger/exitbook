import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { PriceData } from '../contracts/types.js';

/**
 * Sort price data by timestamp (ascending).
 */
export function sortByTimestamp(prices: PriceData[]): PriceData[] {
  return [...prices].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Deduplicate price data, keeping the most recently fetched entry.
 */
export function deduplicatePrices(prices: PriceData[]): PriceData[] {
  const map = new Map<string, PriceData>();

  for (const price of prices) {
    const key = `${price.assetSymbol}:${price.currency}:${price.timestamp.getTime()}`;
    const existing = map.get(key);

    if (!existing || price.fetchedAt > existing.fetchedAt) {
      map.set(key, price);
    }
  }

  return Array.from(map.values());
}

/**
 * Calculate percentage difference between two prices.
 */
export function calculatePriceChange(oldPrice: Decimal, newPrice: Decimal): Decimal {
  if (oldPrice.isZero()) {
    return parseDecimal('0');
  }

  return newPrice.minus(oldPrice).dividedBy(oldPrice).times(100);
}

/**
 * Format a price for display with appropriate decimal places.
 */
export function formatPrice(price: Decimal, currency = 'USD'): string {
  const priceNum = price.toNumber();
  const decimals = priceNum < 0.01 ? 8 : priceNum < 1 ? 6 : 2;

  return `${currency} ${price.toFixed(decimals)}`;
}

/**
 * Pure utility functions for price data operations
 *
 * These are stateless, side-effect-free functions that can be easily tested
 * without mocks. They handle the "functional core" of price data processing.
 */

import type { PriceData, PriceQuery } from './types/index.js';

/**
 * Normalize asset symbol to standard format
 * - Convert to uppercase
 * - Handle common aliases
 */
export function normalizeAssetSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase().trim();

  // Handle common aliases
  const aliases: Record<string, string> = {
    WETH: 'ETH',
    WBTC: 'BTC',
  };

  return aliases[normalized] ?? normalized;
}

/**
 * Normalize currency code to standard format
 */
export function normalizeCurrency(currency: string): string {
  return currency.toUpperCase().trim();
}

/**
 * Round timestamp to nearest day (for daily price lookups)
 */
export function roundToDay(date: Date): Date {
  const rounded = new Date(date);
  rounded.setUTCHours(0, 0, 0, 0);
  return rounded;
}

/**
 * Check if two timestamps are on the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getUTCFullYear() === date2.getUTCFullYear() &&
    date1.getUTCMonth() === date2.getUTCMonth() &&
    date1.getUTCDate() === date2.getUTCDate()
  );
}

/**
 * Validate that price data is reasonable
 * Returns error message if invalid, undefined if valid
 *
 * Pure function - takes current time as parameter for testability
 */
export function validatePriceData(data: PriceData, now: Date = new Date()): string | undefined {
  if (data.price <= 0) {
    return `Invalid price: ${data.price} (must be positive)`;
  }

  if (data.price > 1e12) {
    return `Suspicious price: ${data.price} (unreasonably high)`;
  }

  if (data.timestamp > now) {
    return `Invalid timestamp: ${data.timestamp.toISOString()} (future date)`;
  }

  if (data.fetchedAt < data.timestamp) {
    return `Invalid fetch time: fetched ${data.fetchedAt.toISOString()} before timestamp ${data.timestamp.toISOString()}`;
  }

  return undefined;
}

/**
 * Create a cache key for a price query
 */
export function createCacheKey(query: PriceQuery): string {
  const roundedDate = roundToDay(query.timestamp);
  const normalizedAsset = normalizeAssetSymbol(query.asset);
  const currency = normalizeCurrency(query.currency ?? 'USD');

  return `${normalizedAsset}:${currency}:${roundedDate.getTime()}`;
}

/**
 * Sort price data by timestamp (ascending)
 */
export function sortByTimestamp(prices: PriceData[]): PriceData[] {
  return [...prices].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Deduplicate price data, keeping the most recently fetched
 */
export function deduplicatePrices(prices: PriceData[]): PriceData[] {
  const map = new Map<string, PriceData>();

  for (const price of prices) {
    const key = `${price.asset}:${price.currency}:${price.timestamp.getTime()}`;
    const existing = map.get(key);

    if (!existing || price.fetchedAt > existing.fetchedAt) {
      map.set(key, price);
    }
  }

  return Array.from(map.values());
}

/**
 * Calculate percentage difference between two prices
 */
export function calculatePriceChange(oldPrice: number, newPrice: number): number {
  if (oldPrice === 0) return 0;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}

/**
 * Format price for display with appropriate decimal places
 */
export function formatPrice(price: number, currency = 'USD'): string {
  // Use more decimals for low-value assets
  const decimals = price < 0.01 ? 8 : price < 1 ? 6 : 2;

  return `${currency} ${price.toFixed(decimals)}`;
}

/**
 * Check if a query is within a reasonable time range
 * Returns error message if invalid, undefined if valid
 *
 * Pure function - takes current time as parameter for testability
 */
export function validateQueryTimeRange(timestamp: Date, now: Date = new Date()): string | undefined {
  const minDate = new Date('2009-01-03'); // Bitcoin genesis block

  if (timestamp > now) {
    return `Cannot fetch future prices: ${timestamp.toISOString()}`;
  }

  if (timestamp < minDate) {
    return `Timestamp before crypto era: ${timestamp.toISOString()}`;
  }

  return undefined;
}

import type { PriceData } from '../core/types.js';

/**
 * Validate that price data is reasonable.
 * Returns an error message when invalid.
 */
export function validatePriceData(data: PriceData, now: Date = new Date()): string | undefined {
  if (data.price.lessThanOrEqualTo(0)) {
    return `Invalid price: ${data.price.toFixed()} (must be positive)`;
  }

  if (data.price.greaterThan(1e12)) {
    return `Suspicious price: ${data.price.toFixed()} (unreasonably high)`;
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
 * Check if a query timestamp is within a reasonable historical range.
 */
export function validateQueryTimeRange(timestamp: Date, now: Date = new Date(), isFiat = false): string | undefined {
  const minDate = isFiat ? new Date('1999-01-01') : new Date('2009-01-03');

  if (timestamp > now) {
    return `Cannot fetch future prices: ${timestamp.toISOString()}`;
  }

  if (timestamp < minDate) {
    return isFiat
      ? `Timestamp before FX historical data: ${timestamp.toISOString()}`
      : `Timestamp before crypto era: ${timestamp.toISOString()}`;
  }

  return undefined;
}

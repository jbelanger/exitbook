import type { PriceQuery } from '../contracts/types.js';

import { roundToDay } from './time-buckets.js';

/**
 * Create a cache key for a price query.
 */
export function createCacheKey(query: PriceQuery, defaultCurrency = 'USD'): string {
  const roundedDate = roundToDay(query.timestamp);
  const currency = query.currency ?? defaultCurrency;

  return `${query.assetSymbol.toUpperCase()}:${currency.toUpperCase()}:${roundedDate.getTime()}`;
}

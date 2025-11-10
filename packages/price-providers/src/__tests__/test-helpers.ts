/**
 * Test helpers for price-providers package
 */

import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { PriceData, PriceGranularity } from '../shared/types/index.js';

/**
 * Create a PriceData object for testing
 * Accepts number or string for price and converts to Decimal
 */
export function createTestPriceData(params: {
  asset: Currency;
  currency: Currency;
  fetchedAt: Date;
  granularity?: PriceGranularity | undefined;
  price: number | string | Decimal;
  source: string;
  timestamp: Date;
}): PriceData {
  return {
    ...params,
    price:
      typeof params.price === 'number' || typeof params.price === 'string'
        ? parseDecimal(params.price.toString())
        : params.price,
  };
}

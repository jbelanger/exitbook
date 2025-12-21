/**
 * Test helpers for price-providers package
 */

import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { PriceGranularity } from '../core/types.js';
import type { PriceData } from '../index.js';

/**
 * Create a PriceData object for testing
 * Accepts number or string for price and converts to Decimal
 */
export function createTestPriceData(params: {
  assetSymbol: Currency;
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

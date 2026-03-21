import { type Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { PriceQuery } from '../../contracts/types.js';
import { createCacheKey } from '../cache-key.js';

describe('price-cache/cache-key', () => {
  it('should create consistent cache keys', () => {
    const query: PriceQuery = {
      assetSymbol: 'BTC' as Currency,
      timestamp: new Date('2024-01-15T14:30:00.000Z'),
      currency: 'USD' as Currency,
    };

    expect(createCacheKey(query)).toBe('BTC:USD:1705276800000');
  });

  it('should normalize asset and currency', () => {
    const query: PriceQuery = {
      assetSymbol: 'btc' as Currency,
      timestamp: new Date('2024-01-15T00:00:00.000Z'),
      currency: 'usd' as Currency,
    };

    expect(createCacheKey(query)).toBe('BTC:USD:1705276800000');
  });

  it('should default to USD if currency not specified', () => {
    const query: PriceQuery = {
      assetSymbol: 'ETH' as Currency,
      timestamp: new Date('2024-01-15T00:00:00.000Z'),
      currency: 'USD' as Currency,
    };

    expect(createCacheKey(query)).toBe('ETH:USD:1705276800000');
  });
});

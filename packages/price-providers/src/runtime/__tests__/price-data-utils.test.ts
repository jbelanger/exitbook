import { type Currency, parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { createTestPriceData } from '../../__tests__/test-helpers.js';
import type { PriceData } from '../../contracts/types.js';
import { calculatePriceChange, deduplicatePrices, formatPrice, sortByTimestamp } from '../price-data-utils.js';

describe('runtime/price-data-utils', () => {
  describe('sortByTimestamp', () => {
    it('should sort prices by timestamp ascending', () => {
      const prices: PriceData[] = [
        createTestPriceData({
          assetSymbol: 'BTC' as Currency,
          timestamp: new Date('2024-01-17T00:00:00.000Z'),
          price: 45000,
          currency: 'USD' as Currency,
          source: 'test',
          fetchedAt: new Date(),
        }),
        createTestPriceData({
          assetSymbol: 'BTC' as Currency,
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: 43000,
          currency: 'USD' as Currency,
          source: 'test',
          fetchedAt: new Date(),
        }),
        createTestPriceData({
          assetSymbol: 'BTC' as Currency,
          timestamp: new Date('2024-01-16T00:00:00.000Z'),
          price: 44000,
          currency: 'USD' as Currency,
          source: 'test',
          fetchedAt: new Date(),
        }),
      ];

      const sorted = sortByTimestamp(prices);

      expect(sorted).toHaveLength(3);
      expect(sorted[0]?.price.toNumber()).toBe(43000);
      expect(sorted[1]?.price.toNumber()).toBe(44000);
      expect(sorted[2]?.price.toNumber()).toBe(45000);
    });

    it('should not mutate original array', () => {
      const prices: PriceData[] = [
        createTestPriceData({
          assetSymbol: 'BTC' as Currency,
          timestamp: new Date('2024-01-17T00:00:00.000Z'),
          price: 45000,
          currency: 'USD' as Currency,
          source: 'test',
          fetchedAt: new Date(),
        }),
      ];

      const sorted = sortByTimestamp(prices);
      expect(sorted).not.toBe(prices);
    });
  });

  describe('deduplicatePrices', () => {
    it('should keep most recently fetched price for duplicates', () => {
      const oldFetch = new Date('2024-01-15T10:00:00.000Z');
      const newFetch = new Date('2024-01-15T12:00:00.000Z');
      const timestamp = new Date('2024-01-15T00:00:00.000Z');

      const prices: PriceData[] = [
        createTestPriceData({
          assetSymbol: 'BTC' as Currency,
          timestamp,
          price: 43000,
          currency: 'USD' as Currency,
          source: 'provider1',
          fetchedAt: oldFetch,
        }),
        createTestPriceData({
          assetSymbol: 'BTC' as Currency,
          timestamp,
          price: 43100,
          currency: 'USD' as Currency,
          source: 'provider2',
          fetchedAt: newFetch,
        }),
      ];

      const deduplicated = deduplicatePrices(prices);

      expect(deduplicated).toHaveLength(1);
      expect(deduplicated[0]?.price.toNumber()).toBe(43100);
      expect(deduplicated[0]?.source).toBe('provider2');
    });
  });

  describe('calculatePriceChange', () => {
    it('should calculate percentage change', () => {
      expect(calculatePriceChange(parseDecimal('100'), parseDecimal('110')).toNumber()).toBe(10);
      expect(calculatePriceChange(parseDecimal('100'), parseDecimal('90')).toNumber()).toBe(-10);
    });

    it('should handle zero old price', () => {
      expect(calculatePriceChange(parseDecimal('0'), parseDecimal('100')).toNumber()).toBe(0);
    });
  });

  describe('formatPrice', () => {
    it('should use 2 decimals for prices >= 1', () => {
      expect(formatPrice(parseDecimal('43000'))).toBe('USD 43000.00');
      expect(formatPrice(parseDecimal('1.5'))).toBe('USD 1.50');
    });

    it('should use 6 decimals for prices < 1', () => {
      expect(formatPrice(parseDecimal('0.5'))).toBe('USD 0.500000');
    });

    it('should use 8 decimals for prices < 0.01', () => {
      expect(formatPrice(parseDecimal('0.00012345'))).toBe('USD 0.00012345');
    });

    it('should support custom currency', () => {
      expect(formatPrice(parseDecimal('100'), 'EUR')).toBe('EUR 100.00');
    });
  });
});

import { type Currency, parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { createTestPriceData } from '../../__tests__/test-helpers.js';
import type { PriceData } from '../../contracts/types.js';
import { validatePriceData, validateQueryTimeRange } from '../price-validation.js';

describe('runtime/price-validation', () => {
  describe('validatePriceData', () => {
    const validData: PriceData = createTestPriceData({
      assetSymbol: 'BTC' as Currency,
      timestamp: new Date('2024-01-15T00:00:00.000Z'),
      price: 43000,
      currency: 'USD' as Currency,
      source: 'test',
      fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
    });

    it('should return undefined for valid price data', () => {
      expect(validatePriceData(validData)).toBeUndefined();
    });

    it('should reject negative prices', () => {
      expect(validatePriceData({ ...validData, price: parseDecimal('-100') })).toContain('Invalid price');
    });

    it('should reject zero prices', () => {
      expect(validatePriceData({ ...validData, price: parseDecimal('0') })).toContain('Invalid price');
    });

    it('should reject unreasonably high prices', () => {
      expect(validatePriceData({ ...validData, price: parseDecimal('10000000000000') })).toContain('Suspicious price');
    });

    it('should reject future timestamps', () => {
      const futureDate = new Date(Date.now() + 86400000);
      expect(validatePriceData({ ...validData, timestamp: futureDate, fetchedAt: futureDate })).toContain(
        'future date'
      );
    });

    it('should reject fetched before timestamp', () => {
      expect(
        validatePriceData({
          ...validData,
          timestamp: new Date('2024-01-15T12:00:00.000Z'),
          fetchedAt: new Date('2024-01-15T00:00:00.000Z'),
        })
      ).toContain('Invalid fetch time');
    });
  });

  describe('validateQueryTimeRange', () => {
    it('should return undefined for valid dates', () => {
      expect(validateQueryTimeRange(new Date('2023-01-15T00:00:00.000Z'))).toBeUndefined();
    });

    it('should reject future dates', () => {
      const futureDate = new Date(Date.now() + 86400000);
      expect(validateQueryTimeRange(futureDate)).toContain('future prices');
    });

    it('should reject dates before Bitcoin genesis', () => {
      expect(validateQueryTimeRange(new Date('2008-01-01T00:00:00.000Z'))).toContain('before crypto era');
    });
  });
});

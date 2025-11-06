import { describe, expect, it } from 'vitest';

import { convertToMainUnit, createRawBalanceData } from './balance-utils.ts';

describe('balance-utils', () => {
  describe('convertToMainUnit', () => {
    it('should convert DOT from planck to main unit', () => {
      const result = convertToMainUnit('10000000000', 10);
      expect(result).toBe('1');
    });

    it('should convert TAO from rao to main unit', () => {
      const result = convertToMainUnit('1000000000', 9);
      expect(result).toBe('1');
    });

    it('should handle zero balance', () => {
      const result = convertToMainUnit('0', 10);
      expect(result).toBe('0');
    });

    it('should handle decimal values correctly', () => {
      const result = convertToMainUnit('12345678900', 10);
      expect(result).toBe('1.23456789');
    });
  });

  describe('createRawBalanceData', () => {
    it('should create balance data object', () => {
      const result = createRawBalanceData('10000000000', '1', 10, 'DOT');

      expect(result).toEqual({
        rawAmount: '10000000000',
        decimalAmount: '1',
        decimals: 10,
        symbol: 'DOT',
      });
    });
  });
});

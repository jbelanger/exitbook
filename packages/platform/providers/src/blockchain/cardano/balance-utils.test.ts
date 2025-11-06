import { describe, expect, it } from 'vitest';

import { createRawBalanceData, lovelaceToAda } from './balance-utils.js';

describe('Cardano balance-utils', () => {
  describe('lovelaceToAda', () => {
    it('should convert lovelace string to ADA', () => {
      expect(lovelaceToAda('1000000')).toBe('1');
      expect(lovelaceToAda('500000')).toBe('0.5');
      expect(lovelaceToAda('2500000')).toBe('2.5');
      expect(lovelaceToAda('0')).toBe('0');
    });

    it('should convert lovelace number to ADA', () => {
      expect(lovelaceToAda(1000000)).toBe('1');
      expect(lovelaceToAda(500000)).toBe('0.5');
      expect(lovelaceToAda(2500000)).toBe('2.5');
      expect(lovelaceToAda(0)).toBe('0');
    });

    it('should handle large lovelace amounts', () => {
      const lovelace = '45000000000000'; // 45 billion lovelace = 45 million ADA
      const ada = lovelaceToAda(lovelace);
      expect(ada).toBe('45000000');
    });

    it('should handle fractional lovelace amounts', () => {
      expect(lovelaceToAda('1')).toBe('0.000001');
      expect(lovelaceToAda('100')).toBe('0.0001');
      expect(lovelaceToAda('123456')).toBe('0.123456');
    });
  });

  describe('createRawBalanceData', () => {
    it('should create balance data with correct structure', () => {
      const lovelace = '1000000';
      const ada = '1';
      const result = createRawBalanceData(lovelace, ada);

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '1',
        rawAmount: '1000000',
        symbol: 'ADA',
      });
    });

    it('should handle zero balance', () => {
      const result = createRawBalanceData('0', '0');

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '0',
        rawAmount: '0',
        symbol: 'ADA',
      });
    });

    it('should handle large balance', () => {
      const lovelace = '45000000000000';
      const ada = '45000000';
      const result = createRawBalanceData(lovelace, ada);

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '45000000',
        rawAmount: '45000000000000',
        symbol: 'ADA',
      });
    });
  });
});

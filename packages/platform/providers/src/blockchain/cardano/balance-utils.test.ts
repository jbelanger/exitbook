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

    it('should handle dust amounts (single lovelace)', () => {
      expect(lovelaceToAda('1')).toBe('0.000001');
      expect(lovelaceToAda('10')).toBe('0.00001');
    });

    it('should handle typical transaction fees', () => {
      expect(lovelaceToAda('174261')).toBe('0.174261');
      expect(lovelaceToAda('200000')).toBe('0.2');
      expect(lovelaceToAda('5000000')).toBe('5'); // Large fee
    });

    it('should not use scientific notation for very small amounts', () => {
      const result = lovelaceToAda('1');
      expect(result).toBe('0.000001');
      expect(result).not.toContain('e');
    });

    it('should not use scientific notation for very large amounts', () => {
      const maxSupply = '45000000000000'; // 45 billion ADA in lovelace
      const result = lovelaceToAda(maxSupply);
      expect(result).toBe('45000000');
      expect(result).not.toContain('e');
    });

    it('should preserve precision for complex amounts', () => {
      expect(lovelaceToAda('123456789')).toBe('123.456789');
      expect(lovelaceToAda('1234567')).toBe('1.234567');
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

    it('should handle dust amounts', () => {
      const result = createRawBalanceData('1', '0.000001');

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '0.000001',
        rawAmount: '1',
        symbol: 'ADA',
      });
    });

    it('should always set correct decimals and symbol', () => {
      const result = createRawBalanceData('123456789', '123.456789');

      expect(result.decimals).toBe(6);
      expect(result.symbol).toBe('ADA');
    });

    it('should handle typical balance amounts', () => {
      const result = createRawBalanceData('5000000', '5');

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '5',
        rawAmount: '5000000',
        symbol: 'ADA',
      });
    });
  });
});

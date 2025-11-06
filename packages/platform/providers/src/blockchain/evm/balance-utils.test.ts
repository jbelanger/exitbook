import { describe, expect, it } from 'vitest';

import {
  convertDecimalToWei,
  convertWeiToDecimal,
  filterByContractAddresses,
  filterNonZeroBalances,
  isNativeToken,
} from './balance-utils.js';

describe('balance-utils', () => {
  describe('convertWeiToDecimal', () => {
    it('should convert wei to ETH (18 decimals)', () => {
      expect(convertWeiToDecimal('1000000000000000000', 18)).toBe('1');
    });

    it('should convert wei to decimal with 18 decimals', () => {
      expect(convertWeiToDecimal('1500000000000000000', 18)).toBe('1.5');
    });

    it('should convert wei with 6 decimals (like USDC)', () => {
      expect(convertWeiToDecimal('1000000', 6)).toBe('1');
    });

    it('should handle zero balance', () => {
      expect(convertWeiToDecimal('0', 18)).toBe('0');
    });

    it('should handle very small amounts', () => {
      expect(convertWeiToDecimal('1', 18)).toBe('0.000000000000000001');
    });

    it('should handle very large balances', () => {
      const result = convertWeiToDecimal('1000000000000000000000', 18);
      expect(result).toBe('1000');
    });

    it('should handle fractional amounts with 9 decimals', () => {
      expect(convertWeiToDecimal('1500000000', 9)).toBe('1.5');
    });

    it('should handle custom decimals (4)', () => {
      expect(convertWeiToDecimal('12345', 4)).toBe('1.2345');
    });

    it('should preserve precision for very large numbers', () => {
      const result = convertWeiToDecimal('123456789012345678901234', 18);
      expect(result).toBe('123456.789012345678901234');
    });
  });

  describe('convertDecimalToWei', () => {
    it('should convert ETH to wei (18 decimals)', () => {
      const result = convertDecimalToWei('1', 18);
      expect(result.toFixed()).toBe('1000000000000000000');
    });

    it('should convert decimal to wei with 18 decimals', () => {
      const result = convertDecimalToWei('1.5', 18);
      expect(result.toFixed()).toBe('1500000000000000000');
    });

    it('should convert decimal with 6 decimals (like USDC)', () => {
      const result = convertDecimalToWei('1', 6);
      expect(result.toFixed()).toBe('1000000');
    });

    it('should handle zero', () => {
      const result = convertDecimalToWei('0', 18);
      expect(result.toFixed()).toBe('0');
    });

    it('should handle very small decimal amounts', () => {
      const result = convertDecimalToWei('0.000000000000000001', 18);
      expect(result.toFixed()).toBe('1');
    });

    it('should handle very large amounts', () => {
      const result = convertDecimalToWei('1000', 18);
      expect(result.toFixed()).toBe('1000000000000000000000');
    });

    it('should accept Decimal object as input', () => {
      const result = convertDecimalToWei('1.5', 18);
      const result2 = convertDecimalToWei(result.div('1000000000000000000'), 18);
      expect(result2.toFixed()).toBe('1500000000000000000');
    });

    it('should handle fractional amounts with 9 decimals', () => {
      const result = convertDecimalToWei('1.5', 9);
      expect(result.toFixed()).toBe('1500000000');
    });

    it('should handle custom decimals (4)', () => {
      const result = convertDecimalToWei('1.2345', 4);
      expect(result.toFixed()).toBe('12345');
    });

    it('should preserve precision for very large numbers', () => {
      const result = convertDecimalToWei('123456.789012345678901234', 18);
      expect(result.toFixed()).toBe('123456789012345678901234');
    });
  });

  describe('isNativeToken', () => {
    it('should return true for null address', () => {
      expect(isNativeToken()).toBe(true);
    });

    it('should return true for undefined address', () => {
      expect(isNativeToken()).toBe(true);
    });

    it('should return true for zero address (full)', () => {
      expect(isNativeToken('0x0000000000000000000000000000000000000000')).toBe(true);
    });

    it('should return true for zero address (short)', () => {
      expect(isNativeToken('0x0')).toBe(true);
    });

    it('should return false for token contract address', () => {
      expect(isNativeToken('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(false);
    });

    it('should return false for any non-zero address', () => {
      expect(isNativeToken('0x1234567890abcdef1234567890abcdef12345678')).toBe(false);
    });

    it('should return false for address with only zeros except last digit', () => {
      expect(isNativeToken('0x0000000000000000000000000000000000000001')).toBe(false);
    });

    it('should return true for empty string', () => {
      expect(isNativeToken('')).toBe(true);
    });
  });

  describe('filterNonZeroBalances', () => {
    it('should filter out zero balances', () => {
      const balances = [
        { tokenBalance: '1000000', symbol: 'ETH' },
        { tokenBalance: '0', symbol: 'DAI' },
        { tokenBalance: '5000000', symbol: 'USDC' },
      ];

      const result = filterNonZeroBalances(balances);

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('ETH');
      expect(result[1].symbol).toBe('USDC');
    });

    it('should return empty array when all balances are zero', () => {
      const balances = [
        { tokenBalance: '0', symbol: 'ETH' },
        { tokenBalance: '0', symbol: 'DAI' },
      ];

      const result = filterNonZeroBalances(balances);

      expect(result).toHaveLength(0);
    });

    it('should return all balances when none are zero', () => {
      const balances = [
        { tokenBalance: '1000000', symbol: 'ETH' },
        { tokenBalance: '5000000', symbol: 'USDC' },
        { tokenBalance: '1', symbol: 'WBTC' },
      ];

      const result = filterNonZeroBalances(balances);

      expect(result).toHaveLength(3);
    });

    it('should handle empty array', () => {
      const result = filterNonZeroBalances([]);
      expect(result).toHaveLength(0);
    });

    it('should preserve original object properties', () => {
      const balances = [
        { tokenBalance: '1000000', symbol: 'ETH', decimals: 18, address: '0xabc' },
        { tokenBalance: '0', symbol: 'DAI', decimals: 18, address: '0xdef' },
      ];

      const result = filterNonZeroBalances(balances);

      expect(result[0]).toEqual({
        tokenBalance: '1000000',
        symbol: 'ETH',
        decimals: 18,
        address: '0xabc',
      });
    });
  });

  describe('filterByContractAddresses', () => {
    it('should filter balances by contract addresses', () => {
      const balances = [
        { tokenAddress: '0xabc', symbol: 'ETH' },
        { tokenAddress: '0xdef', symbol: 'DAI' },
        { tokenAddress: '0x123', symbol: 'USDC' },
      ];

      const result = filterByContractAddresses(balances, ['0xabc', '0x123']);

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('ETH');
      expect(result[1].symbol).toBe('USDC');
    });

    it('should return empty array when no addresses match', () => {
      const balances = [
        { tokenAddress: '0xabc', symbol: 'ETH' },
        { tokenAddress: '0xdef', symbol: 'DAI' },
      ];

      const result = filterByContractAddresses(balances, ['0x999']);

      expect(result).toHaveLength(0);
    });

    it('should handle empty contract addresses array', () => {
      const balances = [
        { tokenAddress: '0xabc', symbol: 'ETH' },
        { tokenAddress: '0xdef', symbol: 'DAI' },
      ];

      const result = filterByContractAddresses(balances, []);

      expect(result).toHaveLength(0);
    });

    it('should handle empty balances array', () => {
      const result = filterByContractAddresses([], ['0xabc']);
      expect(result).toHaveLength(0);
    });

    it('should filter out null tokenAddress entries', () => {
      const balances = [
        { tokenAddress: '0xabc', symbol: 'ETH' },
        { tokenAddress: undefined, symbol: 'NATIVE' },
        { tokenAddress: '0xdef', symbol: 'DAI' },
      ];

      const result = filterByContractAddresses(balances, ['0xabc', '0xdef']);

      expect(result).toHaveLength(2);
      expect(result.every((b) => b.tokenAddress !== null)).toBe(true);
    });

    it('should be case-sensitive for addresses', () => {
      const balances = [
        { tokenAddress: '0xabc', symbol: 'ETH' },
        { tokenAddress: '0xABC', symbol: 'DAI' },
      ];

      const result = filterByContractAddresses(balances, ['0xabc']);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('ETH');
    });

    it('should preserve all object properties', () => {
      const balances = [
        { tokenAddress: '0xabc', symbol: 'ETH', decimals: 18, balance: '1000' },
        { tokenAddress: '0xdef', symbol: 'DAI', decimals: 18, balance: '5000' },
      ];

      const result = filterByContractAddresses(balances, ['0xabc']);

      expect(result[0]).toEqual({
        tokenAddress: '0xabc',
        symbol: 'ETH',
        decimals: 18,
        balance: '1000',
      });
    });
  });
});

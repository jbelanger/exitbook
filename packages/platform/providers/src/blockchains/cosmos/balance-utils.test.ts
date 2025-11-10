import { describe, expect, it } from 'vitest';

import { convertBalance, createZeroBalance, findNativeBalance } from './balance-utils.js';
import type { InjectiveBalance } from './providers/injective-explorer/injective-explorer.schemas.js';

describe('balance-utils', () => {
  describe('findNativeBalance', () => {
    it('should find balance with exact lowercase match', () => {
      const balances: InjectiveBalance[] = [
        { denom: 'inj', amount: '1000000' },
        { denom: 'usdc', amount: '5000000' },
      ];

      const result = findNativeBalance(balances, 'INJ');

      expect(result).toEqual({ denom: 'inj', amount: '1000000' });
    });

    it('should find balance with case-insensitive match', () => {
      const balances: InjectiveBalance[] = [
        { denom: 'INJ', amount: '1000000' },
        { denom: 'usdc', amount: '5000000' },
      ];

      const result = findNativeBalance(balances, 'INJ');

      expect(result).toEqual({ denom: 'INJ', amount: '1000000' });
    });

    it('should return undefined when balance not found', () => {
      const balances: InjectiveBalance[] = [
        { denom: 'usdc', amount: '5000000' },
        { denom: 'atom', amount: '2000000' },
      ];

      const result = findNativeBalance(balances, 'INJ');

      expect(result).toBeUndefined();
    });

    it('should return undefined for empty array', () => {
      const balances: InjectiveBalance[] = [];

      const result = findNativeBalance(balances, 'INJ');

      expect(result).toBeUndefined();
    });

    it('should find first matching balance when multiple exist', () => {
      const balances: InjectiveBalance[] = [
        { denom: 'inj', amount: '1000000' },
        { denom: 'INJ', amount: '2000000' },
      ];

      const result = findNativeBalance(balances, 'INJ');

      expect(result).toEqual({ denom: 'inj', amount: '1000000' });
    });
  });

  describe('convertBalance', () => {
    it('should convert balance with 18 decimals', () => {
      const result = convertBalance('1000000000000000000', 18, 'INJ');

      expect(result).toEqual({
        rawAmount: '1000000000000000000',
        decimalAmount: '1',
        decimals: 18,
        symbol: 'INJ',
      });
    });

    it('should convert balance with 6 decimals', () => {
      const result = convertBalance('1000000', 6, 'USDC');

      expect(result).toEqual({
        rawAmount: '1000000',
        decimalAmount: '1',
        decimals: 6,
        symbol: 'USDC',
      });
    });

    it('should handle zero balance', () => {
      const result = convertBalance('0', 18, 'INJ');

      expect(result).toEqual({
        rawAmount: '0',
        decimalAmount: '0',
        decimals: 18,
        symbol: 'INJ',
      });
    });

    it('should handle fractional amounts', () => {
      const result = convertBalance('1500000000000000000', 18, 'INJ');

      expect(result).toEqual({
        rawAmount: '1500000000000000000',
        decimalAmount: '1.5',
        decimals: 18,
        symbol: 'INJ',
      });
    });

    it('should handle very large balances', () => {
      const result = convertBalance('1000000000000000000000', 18, 'INJ');

      expect(result).toEqual({
        rawAmount: '1000000000000000000000',
        decimalAmount: '1000',
        decimals: 18,
        symbol: 'INJ',
      });
    });

    it('should handle very small balances', () => {
      const result = convertBalance('1', 18, 'INJ');

      expect(result).toEqual({
        rawAmount: '1',
        decimalAmount: '0.000000000000000001',
        decimals: 18,
        symbol: 'INJ',
      });
    });

    it('should handle custom decimals', () => {
      const result = convertBalance('12345', 4, 'TOKEN');

      expect(result).toEqual({
        rawAmount: '12345',
        decimalAmount: '1.2345',
        decimals: 4,
        symbol: 'TOKEN',
      });
    });
  });

  describe('createZeroBalance', () => {
    it('should create zero balance with default decimals', () => {
      const result = createZeroBalance('INJ', 18);

      expect(result).toEqual({
        rawAmount: '0',
        decimalAmount: '0',
        decimals: 18,
        symbol: 'INJ',
      });
    });

    it('should create zero balance with custom decimals', () => {
      const result = createZeroBalance('USDC', 6);

      expect(result).toEqual({
        rawAmount: '0',
        decimalAmount: '0',
        decimals: 6,
        symbol: 'USDC',
      });
    });

    it('should create zero balance with any symbol', () => {
      const result = createZeroBalance('ATOM', 6);

      expect(result).toEqual({
        rawAmount: '0',
        decimalAmount: '0',
        decimals: 6,
        symbol: 'ATOM',
      });
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  convertLamportsToSol,
  transformSolBalance,
  transformTokenAccounts,
  transformTokenBalance,
} from '../balance-utils.js';

describe('balance-utils', () => {
  describe('convertLamportsToSol', () => {
    it('should convert lamports to SOL correctly', () => {
      expect(convertLamportsToSol(1000000000)).toBe('1');
      expect(convertLamportsToSol(500000000)).toBe('0.5');
      expect(convertLamportsToSol(1500000000)).toBe('1.5');
    });

    it('should handle string input', () => {
      expect(convertLamportsToSol('1000000000')).toBe('1');
    });

    it('should handle zero', () => {
      expect(convertLamportsToSol(0)).toBe('0');
    });

    it('should handle very large numbers', () => {
      // Note: JavaScript loses precision with very large integers
      // This test verifies the conversion works, but precision may be limited
      const result = convertLamportsToSol('1234567890123456789');
      expect(result).toMatch(/^1234567890\.12345/);
    });
  });

  describe('transformSolBalance', () => {
    it('should transform SOL balance to RawBalanceData format', () => {
      const result = transformSolBalance(1000000000);

      expect(result).toEqual({
        rawAmount: '1000000000',
        decimals: 9,
        decimalAmount: '1',
        symbol: 'SOL',
      });
    });

    it('should handle string lamports', () => {
      const result = transformSolBalance('1000000000');

      expect(result).toEqual({
        rawAmount: '1000000000',
        decimals: 9,
        decimalAmount: '1',
        symbol: 'SOL',
      });
    });
  });

  describe('transformTokenBalance', () => {
    it('should transform token balance to RawBalanceData format', () => {
      const result = transformTokenBalance('mint123', 6, '1000000', '1', 'USDC');

      expect(result).toEqual({
        contractAddress: 'mint123',
        decimals: 6,
        decimalAmount: '1',
        symbol: 'USDC',
        rawAmount: '1000000',
      });
    });

    it('should handle undefined symbol', () => {
      const result = transformTokenBalance('mint123', 6, '1000000', '1');

      expect(result).toEqual({
        contractAddress: 'mint123',
        decimals: 6,
        decimalAmount: '1',
        symbol: undefined,
        rawAmount: '1000000',
      });
    });
  });

  describe('transformTokenAccounts', () => {
    it('should transform array of token accounts', () => {
      const tokenAccounts = [
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: 'mint1',
                  tokenAmount: {
                    amount: '1000000',
                    decimals: 6,
                    uiAmountString: '1',
                  },
                },
              },
            },
          },
        },
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: 'mint2',
                  tokenAmount: {
                    amount: '2000000',
                    decimals: 9,
                    uiAmountString: '0.002',
                  },
                },
              },
            },
          },
        },
      ];

      const result = transformTokenAccounts(tokenAccounts);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        contractAddress: 'mint1',
        decimals: 6,
        decimalAmount: '1',
        symbol: undefined,
        rawAmount: '1000000',
      });
      expect(result[1]).toEqual({
        contractAddress: 'mint2',
        decimals: 9,
        decimalAmount: '0.002',
        symbol: undefined,
        rawAmount: '2000000',
      });
    });

    it('should handle empty array', () => {
      const result = transformTokenAccounts([]);
      expect(result).toHaveLength(0);
    });
  });
});

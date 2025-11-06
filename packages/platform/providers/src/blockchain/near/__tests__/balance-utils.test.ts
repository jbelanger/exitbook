import { describe, expect, it } from 'vitest';

import { convertYoctoNearToNear, transformNearBalance, transformTokenBalance } from '../balance-utils.js';

describe('balance-utils', () => {
  describe('convertYoctoNearToNear', () => {
    it('should convert yoctoNEAR to NEAR decimal string', () => {
      expect(convertYoctoNearToNear('1000000000000000000000000')).toBe('1');
      expect(convertYoctoNearToNear('500000000000000000000000')).toBe('0.5');
      expect(convertYoctoNearToNear('2500000000000000000000000')).toBe('2.5');
    });

    it('should handle string input', () => {
      expect(convertYoctoNearToNear('1000000000000000000000000')).toBe('1');
    });

    it('should handle number input', () => {
      expect(convertYoctoNearToNear(1000000000000000000000000)).toBe('1');
    });

    it('should handle zero', () => {
      expect(convertYoctoNearToNear(0)).toBe('0');
      expect(convertYoctoNearToNear('0')).toBe('0');
    });

    it('should handle very small amounts', () => {
      expect(convertYoctoNearToNear('1')).toBe('0.000000000000000000000001');
      expect(convertYoctoNearToNear('100')).toBe('0.0000000000000000000001');
    });

    it('should handle very large amounts', () => {
      // 1 million NEAR
      expect(convertYoctoNearToNear('1000000000000000000000000000000')).toBe('1000000');
      // 1 billion NEAR
      expect(convertYoctoNearToNear('1000000000000000000000000000000000')).toBe('1000000000');
    });

    it('should handle fractional results with precision', () => {
      expect(convertYoctoNearToNear('123456789012345678901234')).toBe('0.123456789012345678901234');
      expect(convertYoctoNearToNear('999999999999999999999999')).toBe('0.999999999999999999999999');
    });
  });

  describe('transformNearBalance', () => {
    it('should transform NEAR balance to RawBalanceData format', () => {
      const result = transformNearBalance('1000000000000000000000000');

      expect(result).toEqual({
        decimals: 24,
        decimalAmount: '1',
        rawAmount: '1000000000000000000000000',
        symbol: 'NEAR',
      });
    });

    it('should handle number input', () => {
      const result = transformNearBalance(1000000000000000000000000);

      expect(result).toEqual({
        decimals: 24,
        decimalAmount: '1',
        rawAmount: '1000000000000000000000000',
        symbol: 'NEAR',
      });
    });

    it('should handle zero balance', () => {
      const result = transformNearBalance('0');

      expect(result).toEqual({
        decimals: 24,
        decimalAmount: '0',
        rawAmount: '0',
        symbol: 'NEAR',
      });
    });

    it('should handle very small balances', () => {
      const result = transformNearBalance('1');

      expect(result).toEqual({
        decimals: 24,
        decimalAmount: '0.000000000000000000000001',
        rawAmount: '1',
        symbol: 'NEAR',
      });
    });

    it('should handle very large balances', () => {
      const result = transformNearBalance('1000000000000000000000000000000');

      expect(result).toEqual({
        decimals: 24,
        decimalAmount: '1000000',
        rawAmount: '1000000000000000000000000000000',
        symbol: 'NEAR',
      });
    });

    it('should handle fractional NEAR amounts', () => {
      const result = transformNearBalance('1500000000000000000000000');

      expect(result).toEqual({
        decimals: 24,
        decimalAmount: '1.5',
        rawAmount: '1500000000000000000000000',
        symbol: 'NEAR',
      });
    });

    it('should always have NEAR symbol', () => {
      const result = transformNearBalance('100');
      expect(result.symbol).toBe('NEAR');
    });

    it('should always have 24 decimals', () => {
      const result = transformNearBalance('100');
      expect(result.decimals).toBe(24);
    });
  });

  describe('transformTokenBalance', () => {
    it('should transform token balance to RawBalanceData format', () => {
      const result = transformTokenBalance('usdt.tether-token.near', 6, '1000000', '1', 'USDT');

      expect(result).toEqual({
        contractAddress: 'usdt.tether-token.near',
        decimals: 6,
        decimalAmount: '1',
        rawAmount: '1000000',
        symbol: 'USDT',
      });
    });

    it('should handle undefined symbol', () => {
      const result = transformTokenBalance('token.near', 18, '1000000000000000000', '1');

      expect(result).toEqual({
        contractAddress: 'token.near',
        decimals: 18,
        decimalAmount: '1',
        rawAmount: '1000000000000000000',
        symbol: undefined,
      });
    });

    it('should handle zero balance', () => {
      const result = transformTokenBalance('token.near', 6, '0', '0', 'TKN');

      expect(result).toEqual({
        contractAddress: 'token.near',
        decimals: 6,
        decimalAmount: '0',
        rawAmount: '0',
        symbol: 'TKN',
      });
    });

    it('should handle different decimal places', () => {
      // 6 decimals (like USDT)
      const result6 = transformTokenBalance('usdt.near', 6, '1000000', '1', 'USDT');
      expect(result6.decimals).toBe(6);

      // 18 decimals (like many ERC20 tokens)
      const result18 = transformTokenBalance('token.near', 18, '1000000000000000000', '1', 'TKN');
      expect(result18.decimals).toBe(18);

      // 0 decimals (like some NFTs)
      const result0 = transformTokenBalance('nft.near', 0, '1', '1', 'NFT');
      expect(result0.decimals).toBe(0);
    });

    it('should handle very large token amounts', () => {
      const result = transformTokenBalance('token.near', 18, '1000000000000000000000000000', '1000000000', 'LARGE');

      expect(result).toEqual({
        contractAddress: 'token.near',
        decimals: 18,
        decimalAmount: '1000000000',
        rawAmount: '1000000000000000000000000000',
        symbol: 'LARGE',
      });
    });

    it('should handle fractional amounts', () => {
      const result = transformTokenBalance('usdt.near', 6, '1500000', '1.5', 'USDT');

      expect(result).toEqual({
        contractAddress: 'usdt.near',
        decimals: 6,
        decimalAmount: '1.5',
        rawAmount: '1500000',
        symbol: 'USDT',
      });
    });

    it('should preserve contract address exactly', () => {
      const contractAddress = 'very-long.sub-account.parent.near';
      const result = transformTokenBalance(contractAddress, 6, '1000000', '1', 'TKN');

      expect(result.contractAddress).toBe(contractAddress);
    });

    it('should handle implicit contract addresses', () => {
      const implicitAddress = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';
      const result = transformTokenBalance(implicitAddress, 6, '1000000', '1', 'TKN');

      expect(result.contractAddress).toBe(implicitAddress);
    });
  });
});

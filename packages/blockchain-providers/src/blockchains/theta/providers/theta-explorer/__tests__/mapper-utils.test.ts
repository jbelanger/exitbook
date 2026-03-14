import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { formatThetaAmount, isThetaTokenTransfer, selectThetaCurrency } from '../theta-explorer.mapper-utils.js';

describe('theta-explorer/mapper-utils', () => {
  describe('selectThetaCurrency', () => {
    it('should select THETA when amount is greater than zero', () => {
      const result = selectThetaCurrency(parseDecimal('100'), new Decimal('50'));
      expect(result.currency).toBe('THETA');
      expect(result.amount.toFixed()).toBe('100');
    });

    it('should select TFUEL when THETA is zero and TFUEL is positive', () => {
      const result = selectThetaCurrency(parseDecimal('0'), new Decimal('50'));
      expect(result.currency).toBe('TFUEL');
      expect(result.amount.toFixed()).toBe('50');
    });

    it('should default to TFUEL with zero amount when both are zero', () => {
      const result = selectThetaCurrency(parseDecimal('0'), new Decimal('0'));
      expect(result.currency).toBe('TFUEL');
      expect(result.amount.toFixed()).toBe('0');
    });

    it('should prioritize THETA over TFUEL when both are positive', () => {
      const result = selectThetaCurrency(parseDecimal('100'), new Decimal('200'));
      expect(result.currency).toBe('THETA');
      expect(result.amount.toFixed()).toBe('100');
    });
  });

  describe('isThetaTokenTransfer', () => {
    it('should return true for THETA', () => {
      expect(isThetaTokenTransfer('THETA')).toBe(true);
    });

    it('should return false for TFUEL', () => {
      expect(isThetaTokenTransfer('TFUEL')).toBe(false);
    });

    it('should return false for other currencies', () => {
      expect(isThetaTokenTransfer('ETH')).toBe(false);
      expect(isThetaTokenTransfer('BTC')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isThetaTokenTransfer('theta')).toBe(false);
      expect(isThetaTokenTransfer('Theta')).toBe(false);
    });
  });

  describe('formatThetaAmount', () => {
    it('should convert THETA amount from wei to decimal', () => {
      const amount = parseDecimal('1000000000000000000');
      const result = formatThetaAmount(amount, true, 18);
      expect(result).toBe('1');
    });

    it('should keep TFUEL amount in wei', () => {
      const amount = parseDecimal('1000000000000000000');
      const result = formatThetaAmount(amount, false, 18);
      expect(result).toBe('1000000000000000000');
    });

    it('should handle fractional THETA amounts', () => {
      const amount = parseDecimal('1500000000000000000');
      const result = formatThetaAmount(amount, true, 18);
      expect(result).toBe('1.5');
    });

    it('should handle zero amount', () => {
      const amount = parseDecimal('0');
      const result = formatThetaAmount(amount, true, 18);
      expect(result).toBe('0');
    });

    it('should use toFixed for TFUEL to avoid scientific notation', () => {
      const amount = parseDecimal('1000000000000000000000');
      const result = formatThetaAmount(amount, false, 18);
      expect(result).not.toContain('e');
      expect(result).toBe('1000000000000000000000');
    });
  });
});

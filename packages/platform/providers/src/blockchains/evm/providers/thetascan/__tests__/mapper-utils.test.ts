import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { isThetaTokenTransfer, parseCommaFormattedNumber, selectThetaCurrency } from '../thetascan.mapper-utils.js';

describe('thetascan/mapper-utils', () => {
  describe('parseCommaFormattedNumber', () => {
    it('should parse number with commas', () => {
      const result = parseCommaFormattedNumber('1,000,000.50');
      expect(result.toFixed()).toBe('1000000.5');
    });

    it('should parse number without commas', () => {
      const result = parseCommaFormattedNumber('1000000.50');
      expect(result.toFixed()).toBe('1000000.5');
    });

    it('should handle single comma', () => {
      const result = parseCommaFormattedNumber('1,000');
      expect(result.toFixed()).toBe('1000');
    });

    it('should handle multiple commas', () => {
      const result = parseCommaFormattedNumber('1,234,567,890.123456');
      expect(result.toFixed()).toBe('1234567890.123456');
    });

    it('should handle zero', () => {
      const result = parseCommaFormattedNumber('0');
      expect(result.toFixed()).toBe('0');
    });

    it('should handle decimal only', () => {
      const result = parseCommaFormattedNumber('0.123');
      expect(result.toFixed()).toBe('0.123');
    });
  });

  describe('selectThetaCurrency', () => {
    it('should select THETA when amount is greater than zero', () => {
      const result = selectThetaCurrency(new Decimal('100'), new Decimal('50'));
      expect(result.currency).toBe('THETA');
      expect(result.amount.toFixed()).toBe('100');
    });

    it('should select TFUEL when THETA is zero and TFUEL is positive', () => {
      const result = selectThetaCurrency(new Decimal('0'), new Decimal('50'));
      expect(result.currency).toBe('TFUEL');
      expect(result.amount.toFixed()).toBe('50');
    });

    it('should default to TFUEL with zero amount when both are zero', () => {
      const result = selectThetaCurrency(new Decimal('0'), new Decimal('0'));
      expect(result.currency).toBe('TFUEL');
      expect(result.amount.toFixed()).toBe('0');
    });

    it('should prioritize THETA over TFUEL when both are positive', () => {
      const result = selectThetaCurrency(new Decimal('100'), new Decimal('200'));
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
});

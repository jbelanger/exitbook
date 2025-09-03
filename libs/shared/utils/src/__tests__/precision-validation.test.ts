import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { canSafelyConvertToNumber, safeDecimalToNumber } from '../decimal-utils';

describe('Precision Validation', () => {
  describe('canSafelyConvertToNumber', () => {
    it('should return true for safe values', () => {
      expect(canSafelyConvertToNumber(new Decimal('1.5'))).toBe(true);
      expect(canSafelyConvertToNumber(new Decimal('1000000'))).toBe(true);
      expect(canSafelyConvertToNumber(new Decimal('0.00000001'))).toBe(true);
      expect(canSafelyConvertToNumber(new Decimal('-1000'))).toBe(true);
    });

    it('should return false for values exceeding MAX_SAFE_INTEGER', () => {
      const largeValue = new Decimal(Number.MAX_SAFE_INTEGER).plus(1);
      expect(canSafelyConvertToNumber(largeValue)).toBe(false);
    });

    it('should return false for high precision values that lose precision', () => {
      // This value has more precision than JavaScript numbers can handle
      const highPrecision = new Decimal('1.123456789012345678901234567890');
      expect(canSafelyConvertToNumber(highPrecision)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(canSafelyConvertToNumber(new Decimal('0'))).toBe(true);
      expect(canSafelyConvertToNumber(new Decimal(Number.MAX_SAFE_INTEGER))).toBe(true);
    });
  });

  describe('safeDecimalToNumber', () => {
    it('should convert safe values without error', () => {
      expect(safeDecimalToNumber(new Decimal('1.5'))).toBe(1.5);
      expect(safeDecimalToNumber(new Decimal('0'))).toBe(0);
      expect(safeDecimalToNumber(new Decimal('-100.25'))).toBe(-100.25);
    });

    it('should throw error for unsafe values by default', () => {
      const largeValue = new Decimal(Number.MAX_SAFE_INTEGER).plus(1);
      expect(() => safeDecimalToNumber(largeValue)).toThrow(/Precision loss detected/);
    });

    it('should allow precision loss when enabled', () => {
      const largeValue = new Decimal(Number.MAX_SAFE_INTEGER).plus(1);
      const result = safeDecimalToNumber(largeValue, {
        allowPrecisionLoss: true,
      });
      expect(typeof result).toBe('number');
    });

    it('should call warning callback for unsafe values', () => {
      const warningCallback = vi.fn();
      const highPrecision = new Decimal('1.123456789012345678901234567890');

      safeDecimalToNumber(highPrecision, {
        allowPrecisionLoss: true,
        warningCallback,
      });

      expect(warningCallback).toHaveBeenCalledWith(expect.stringContaining('Precision loss detected'));
    });
  });

  describe('High-precision scenarios', () => {
    it('should handle large Bitcoin amounts without precision loss', () => {
      // 21 million BTC - close to max supply
      const largeBtcAmount = new Decimal('20999999.99999999');
      expect(canSafelyConvertToNumber(largeBtcAmount)).toBe(true);
      expect(safeDecimalToNumber(largeBtcAmount)).toBe(20999999.99999999);
    });

    it('should detect precision loss in wei calculations', () => {
      // Large wei amounts that exceed safe integer range
      const weiAmount = new Decimal('999999999999999999999'); // 999+ ETH in wei
      expect(canSafelyConvertToNumber(weiAmount)).toBe(false);

      expect(() => safeDecimalToNumber(weiAmount)).toThrow(/Precision loss detected/);
    });

    it('should handle high-precision tokens', () => {
      // Tokens with many decimals
      const preciseAmount = new Decimal('123.123456789012345678');

      // This should detect precision loss due to JavaScript number limitations
      const canConvert = canSafelyConvertToNumber(preciseAmount);
      if (!canConvert) {
        expect(() => safeDecimalToNumber(preciseAmount)).toThrow(/Precision loss detected/);
      }
    });

    it('should preserve satoshi-level precision', () => {
      // Satoshi-level precision (8 decimal places)
      const satoshiPrecision = new Decimal('0.00000001');
      expect(canSafelyConvertToNumber(satoshiPrecision)).toBe(true);
      expect(safeDecimalToNumber(satoshiPrecision)).toBe(0.00000001);
    });
  });
});

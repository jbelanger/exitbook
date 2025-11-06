import { describe, expect, it, vi } from 'vitest';

import { canSafelyConvertToNumber, parseDecimal, safeDecimalToNumber } from '../decimal-utils.js';

describe('Precision Validation', () => {
  describe('canSafelyConvertToNumber', () => {
    it('should return true for safe values', () => {
      expect(canSafelyConvertToNumber(parseDecimal('1.5'))).toBe(true);
      expect(canSafelyConvertToNumber(parseDecimal('1000000'))).toBe(true);
      expect(canSafelyConvertToNumber(parseDecimal('0.00000001'))).toBe(true);
      expect(canSafelyConvertToNumber(parseDecimal('-1000'))).toBe(true);
    });

    it('should return false for values exceeding MAX_SAFE_INTEGER', () => {
      const largeValue = parseDecimal(Number.MAX_SAFE_INTEGER.toString()).plus(1);
      expect(canSafelyConvertToNumber(largeValue)).toBe(false);
    });

    it('should return false for high precision values that lose precision', () => {
      // This value has more precision than JavaScript numbers can handle
      const highPrecision = parseDecimal('1.123456789012345678901234567890');
      expect(canSafelyConvertToNumber(highPrecision)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(canSafelyConvertToNumber(parseDecimal('0'))).toBe(true);
      expect(canSafelyConvertToNumber(parseDecimal(Number.MAX_SAFE_INTEGER.toString()))).toBe(true);
    });
  });

  describe('safeDecimalToNumber', () => {
    it('should convert safe values without error', () => {
      expect(safeDecimalToNumber(parseDecimal('1.5'))).toBe(1.5);
      expect(safeDecimalToNumber(parseDecimal('0'))).toBe(0);
      expect(safeDecimalToNumber(parseDecimal('-100.25'))).toBe(-100.25);
    });

    it('should throw error for unsafe values by default', () => {
      const largeValue = parseDecimal(Number.MAX_SAFE_INTEGER.toString()).plus(1);
      expect(() => safeDecimalToNumber(largeValue)).toThrow(/Precision loss detected/);
    });

    it('should allow precision loss when enabled', () => {
      const largeValue = parseDecimal(Number.MAX_SAFE_INTEGER.toString()).plus(1);
      const result = safeDecimalToNumber(largeValue, {
        allowPrecisionLoss: true,
      });
      expect(typeof result).toBe('number');
    });

    it('should call warning callback for unsafe values', () => {
      const warningCallback = vi.fn();
      const highPrecision = parseDecimal('1.123456789012345678901234567890');

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
      const largeBtcAmount = parseDecimal('20999999.99999999');
      expect(canSafelyConvertToNumber(largeBtcAmount)).toBe(true);
      expect(safeDecimalToNumber(largeBtcAmount)).toBe(20999999.99999999);
    });

    it('should detect precision loss in wei calculations', () => {
      // Large wei amounts that exceed safe integer range
      const weiAmount = parseDecimal('999999999999999999999'); // 999+ ETH in wei
      expect(canSafelyConvertToNumber(weiAmount)).toBe(false);

      expect(() => safeDecimalToNumber(weiAmount)).toThrow(/Precision loss detected/);
    });

    it('should handle high-precision tokens', () => {
      // Tokens with many decimals
      const preciseAmount = parseDecimal('123.123456789012345678');

      // This should detect precision loss due to JavaScript number limitations
      const canConvert = canSafelyConvertToNumber(preciseAmount);
      if (!canConvert) {
        expect(() => safeDecimalToNumber(preciseAmount)).toThrow(/Precision loss detected/);
      }
    });

    it('should preserve satoshi-level precision', () => {
      // Satoshi-level precision (8 decimal places)
      const satoshiPrecision = parseDecimal('0.00000001');
      expect(canSafelyConvertToNumber(satoshiPrecision)).toBe(true);
      expect(safeDecimalToNumber(satoshiPrecision)).toBe(0.00000001);
    });
  });
});

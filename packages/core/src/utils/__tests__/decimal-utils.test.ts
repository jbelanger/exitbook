import { describe, expect, it } from 'vitest';

import { tryParseDecimal, parseDecimal } from '../decimal-utils.ts';

describe('Decimal Utilities', () => {
  describe('tryParseDecimal', () => {
    it('should parse valid string to Decimal', () => {
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal('123.456', out);

      expect(result).toBe(true);
      expect(out.value.toString()).toBe('123.456');
    });

    it('should parse Decimal instance', () => {
      const input = parseDecimal('789.012');
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal(input, out);

      expect(result).toBe(true);
      expect(out.value.toString()).toBe('789.012');
    });

    it('should handle undefined as zero', () => {
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal(undefined, out);

      expect(result).toBe(true);
      expect(out.value.isZero()).toBe(true);
    });

    it('should handle null as zero', () => {
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal(null, out);

      expect(result).toBe(true);
      expect(out.value.isZero()).toBe(true);
    });

    it('should handle empty string as zero', () => {
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal('', out);

      expect(result).toBe(true);
      expect(out.value.isZero()).toBe(true);
    });

    it('should return false for invalid strings', () => {
      const out = { value: parseDecimal('0') };
      expect(tryParseDecimal('invalid', out)).toBe(false);
      expect(tryParseDecimal('12.34.56', out)).toBe(false);
      expect(tryParseDecimal('abc123', out)).toBe(false);
    });

    it('should work without out parameter', () => {
      expect(tryParseDecimal('123.456')).toBe(true);
      expect(tryParseDecimal('invalid')).toBe(false);
      expect(tryParseDecimal(void 0)).toBe(true);
    });

    it('should handle negative numbers', () => {
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal('-456.789', out);

      expect(result).toBe(true);
      expect(out.value.toString()).toBe('-456.789');
    });

    it('should handle scientific notation', () => {
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal('1.23e5', out);

      expect(result).toBe(true);
      expect(out.value.toNumber()).toBe(123000);
    });

    it('should handle very small numbers', () => {
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal('0.00000001', out);

      expect(result).toBe(true);
      expect(out.value.toFixed()).toBe('0.00000001');
    });

    it('should handle very large numbers', () => {
      const out = { value: parseDecimal('0') };
      const result = tryParseDecimal('999999999999999999', out);

      expect(result).toBe(true);
      expect(out.value.toString()).toBe('999999999999999999');
    });
  });

  describe('parseDecimal', () => {
    it('should parse valid string to Decimal', () => {
      const result = parseDecimal('123.456');
      expect(result.toString()).toBe('123.456');
    });

    it('should parse Decimal instance', () => {
      const input = parseDecimal('789.012');
      const result = parseDecimal(input);
      expect(result.toString()).toBe('789.012');
    });

    it('should return zero for undefined', () => {
      const result = parseDecimal(void 0);
      expect(result.isZero()).toBe(true);
    });

    it('should return zero for null', () => {
      const result = parseDecimal(null);
      expect(result.isZero()).toBe(true);
    });

    it('should return zero for empty string', () => {
      const result = parseDecimal('');
      expect(result.isZero()).toBe(true);
    });

    it('should return zero for invalid strings', () => {
      expect(parseDecimal('invalid').isZero()).toBe(true);
      expect(parseDecimal('not a number').isZero()).toBe(true);
    });

    it('should handle negative numbers', () => {
      const result = parseDecimal('-123.456');
      expect(result.toString()).toBe('-123.456');
    });

    it('should handle zero', () => {
      expect(parseDecimal('0').isZero()).toBe(true);
      expect(parseDecimal('0.0').isZero()).toBe(true);
      expect(parseDecimal('-0').isZero()).toBe(true);
    });
  });
});

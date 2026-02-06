import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { parseDecimal } from '../utils/decimal-utils.js';

import { DecimalSchema, DecimalStringSchema } from './money.js';

describe('DecimalSchema', () => {
  it('should accept valid string numbers', () => {
    const result = DecimalSchema.parse('123.456');
    expect(result).toBeInstanceOf(Decimal);
    expect(result.toString()).toBe('123.456');
  });

  it('should accept valid numbers', () => {
    const result = DecimalSchema.parse(123.456);
    expect(result).toBeInstanceOf(Decimal);
    expect(result.toString()).toBe('123.456');
  });

  it('should accept Decimal instances', () => {
    const decimal = parseDecimal('123.456');
    const result = DecimalSchema.parse(decimal);
    expect(result).toBeInstanceOf(Decimal);
    expect(result.toString()).toBe('123.456');
  });

  it('should handle scientific notation from numbers', () => {
    const result = DecimalSchema.parse(1e-8);
    expect(result).toBeInstanceOf(Decimal);
    expect(result.toString()).toBe('1e-8');
  });
});

describe('DecimalStringSchema', () => {
  describe('valid inputs', () => {
    it('should accept valid string numbers and return fixed-point string', () => {
      const result = DecimalStringSchema.parse('123.456');
      expect(result).toBe('123.456');
    });

    it('should accept valid numbers and return fixed-point string', () => {
      const result = DecimalStringSchema.parse(123.456);
      expect(result).toBe('123.456');
    });

    it('should accept Decimal instances and return fixed-point string', () => {
      const decimal = parseDecimal('123.456');
      const result = DecimalStringSchema.parse(decimal);
      expect(result).toBe('123.456');
    });

    it('should convert scientific notation to fixed-point string', () => {
      const result = DecimalStringSchema.parse(1e-8);
      expect(result).toBe('0.00000001');
    });

    it('should accept zero', () => {
      const result = DecimalStringSchema.parse('0');
      expect(result).toBe('0');
    });

    it('should accept negative numbers', () => {
      const result = DecimalStringSchema.parse('-123.456');
      expect(result).toBe('-123.456');
    });
  });

  describe('invalid inputs', () => {
    it('should reject empty string', () => {
      expect(() => DecimalStringSchema.parse('')).toThrow('Must be a valid numeric string or number');
    });

    it('should reject non-numeric strings', () => {
      expect(() => DecimalStringSchema.parse('foo')).toThrow('Must be a valid numeric string or number');
    });

    it('should reject strings with commas', () => {
      expect(() => DecimalStringSchema.parse('1,2,3')).toThrow('Must be a valid numeric string or number');
    });

    it('should reject invalid formats', () => {
      expect(() => DecimalStringSchema.parse('12.34.56')).toThrow('Must be a valid numeric string or number');
    });

    it('should reject alphabetic characters mixed with numbers', () => {
      expect(() => DecimalStringSchema.parse('12abc')).toThrow('Must be a valid numeric string or number');
    });

    it('should reject null', () => {
      const invalidNullValue: unknown = JSON.parse('null');
      expect(() => DecimalStringSchema.parse(invalidNullValue)).toThrow();
    });

    it('should reject undefined', () => {
      expect(() => DecimalStringSchema.parse(void 0)).toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle very large numbers', () => {
      const result = DecimalStringSchema.parse('999999999999999999999999999999');
      expect(result).toBe('999999999999999999999999999999');
    });

    it('should handle very small numbers', () => {
      const result = DecimalStringSchema.parse('0.000000000000000001');
      expect(result).toBe('0.000000000000000001');
    });

    it('should handle string with leading zeros', () => {
      const result = DecimalStringSchema.parse('00123.456');
      expect(result).toBe('123.456');
    });

    it('should handle string with trailing zeros', () => {
      const result = DecimalStringSchema.parse('123.4560000');
      expect(result).toBe('123.456');
    });
  });
});

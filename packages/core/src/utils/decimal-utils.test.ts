import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  addMoney,
  createMoney,
  dbStringToMoney,
  decimalToString,
  formatDecimal,
  isZeroMoney,
  moneyEquals,
  moneyToDbString,
  moneyToNumber,
  parseDecimal,
  stringToDecimal,
  subtractMoney,
  tryParseDecimal,
} from './decimal-utils.js';

describe('Decimal Utilities', () => {
  describe('tryParseDecimal', () => {
    it('should parse valid string to Decimal', () => {
      const out = { value: new Decimal(0) };
      const result = tryParseDecimal('123.456', out);

      expect(result).toBe(true);
      expect(out.value.toString()).toBe('123.456');
    });

    it('should parse Decimal instance', () => {
      const input = new Decimal('789.012');
      const out = { value: new Decimal(0) };
      const result = tryParseDecimal(input, out);

      expect(result).toBe(true);
      expect(out.value.toString()).toBe('789.012');
    });

    it('should handle undefined as zero', () => {
      const out = { value: new Decimal(0) };
      const result = tryParseDecimal(undefined, out);

      expect(result).toBe(true);
      expect(out.value.isZero()).toBe(true);
    });

    it('should handle null as zero', () => {
      const out = { value: new Decimal(0) };
      const result = tryParseDecimal(null, out);

      expect(result).toBe(true);
      expect(out.value.isZero()).toBe(true);
    });

    it('should handle empty string as zero', () => {
      const out = { value: new Decimal(0) };
      const result = tryParseDecimal('', out);

      expect(result).toBe(true);
      expect(out.value.isZero()).toBe(true);
    });

    it('should return false for invalid strings', () => {
      const out = { value: new Decimal(0) };
      expect(tryParseDecimal('invalid', out)).toBe(false);
      expect(tryParseDecimal('12.34.56', out)).toBe(false);
      expect(tryParseDecimal('abc123', out)).toBe(false);
    });

    it('should work without out parameter', () => {
      expect(tryParseDecimal('123.456')).toBe(true);
      expect(tryParseDecimal('invalid')).toBe(false);
      expect(tryParseDecimal()).toBe(true);
    });

    it('should handle negative numbers', () => {
      const out = { value: new Decimal(0) };
      const result = tryParseDecimal('-456.789', out);

      expect(result).toBe(true);
      expect(out.value.toString()).toBe('-456.789');
    });

    it('should handle scientific notation', () => {
      const out = { value: new Decimal(0) };
      const result = tryParseDecimal('1.23e5', out);

      expect(result).toBe(true);
      expect(out.value.toNumber()).toBe(123000);
    });

    it('should handle very small numbers', () => {
      const out = { value: new Decimal(0) };
      const result = tryParseDecimal('0.00000001', out);

      expect(result).toBe(true);
      expect(out.value.toFixed()).toBe('0.00000001');
    });

    it('should handle very large numbers', () => {
      const out = { value: new Decimal(0) };
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
      const input = new Decimal('789.012');
      const result = parseDecimal(input);
      expect(result.toString()).toBe('789.012');
    });

    it('should return zero for undefined', () => {
      const result = parseDecimal();
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

  describe('createMoney', () => {
    it('should create Money object with valid inputs', () => {
      const money = createMoney('100.50', 'USD');

      expect(money.amount.toFixed()).toBe('100.5');
      expect(money.currency.toString()).toBe('USD');
    });

    it('should create Money object with Decimal amount', () => {
      const amount = new Decimal('50.25');
      const money = createMoney(amount, 'EUR');

      expect(money.amount.toString()).toBe('50.25');
      expect(money.currency.toString()).toBe('EUR');
    });

    it('should handle undefined amount as zero', () => {
      const money = createMoney(undefined, 'BTC');

      expect(money.amount.isZero()).toBe(true);
      expect(money.currency.toString()).toBe('BTC');
    });

    it('should handle null amount as zero', () => {
      const money = createMoney(null, 'ETH');

      expect(money.amount.isZero()).toBe(true);
      expect(money.currency.toString()).toBe('ETH');
    });

    it('should normalize currency to uppercase', () => {
      const money = createMoney('100', 'btc');

      expect(money.currency.toString()).toBe('BTC');
    });

    it('should handle empty currency as unknown', () => {
      const money = createMoney('100', '');

      expect(money.currency.toString()).toBe('UNKNOWN');
    });

    it('should handle undefined currency as unknown', () => {
      const money = createMoney('100', undefined as unknown as string);

      expect(money.currency.toString()).toBe('UNKNOWN');
    });

    it('should handle very small amounts', () => {
      const money = createMoney('0.00000001', 'BTC');

      expect(money.amount.toFixed()).toBe('0.00000001');
    });

    it('should handle very large amounts', () => {
      const money = createMoney('1000000000000', 'SHIB');

      expect(money.amount.toString()).toBe('1000000000000');
    });
  });

  describe('moneyToNumber', () => {
    it('should convert Money to number', () => {
      const money = createMoney('123.456', 'USD');
      const result = moneyToNumber(money);

      expect(result).toBe(123.456);
    });

    it('should return number as-is', () => {
      const result = moneyToNumber(456.789);

      expect(result).toBe(456.789);
    });

    it('should return zero for undefined', () => {
      const result = moneyToNumber();

      expect(result).toBe(0);
    });

    it('should handle zero money', () => {
      const money = createMoney('0', 'USD');
      const result = moneyToNumber(money);

      expect(result).toBe(0);
    });

    it('should handle negative amounts', () => {
      const money = createMoney('-100.50', 'EUR');
      const result = moneyToNumber(money);

      expect(result).toBe(-100.5);
    });

    it('should handle very small amounts', () => {
      const money = createMoney('0.00000001', 'BTC');
      const result = moneyToNumber(money);

      expect(result).toBe(0.00000001);
    });
  });

  describe('formatDecimal', () => {
    it('should format decimal with default precision', () => {
      const decimal = new Decimal('123.456789012');
      const result = formatDecimal(decimal);

      expect(result).toBe('123.45678901');
    });

    it('should format decimal with custom precision', () => {
      const decimal = new Decimal('123.456789');
      const result = formatDecimal(decimal, 4);

      expect(result).toBe('123.4568');
    });

    it('should remove trailing zeros', () => {
      const decimal = new Decimal('123.45000000');
      const result = formatDecimal(decimal);

      expect(result).toBe('123.45');
    });

    it('should remove trailing decimal point', () => {
      const decimal = new Decimal('123');
      const result = formatDecimal(decimal);

      expect(result).toBe('123');
    });

    it('should handle zero', () => {
      const decimal = new Decimal('0');
      const result = formatDecimal(decimal);

      expect(result).toBe('0');
    });

    it('should handle very small numbers', () => {
      const decimal = new Decimal('0.00000001');
      const result = formatDecimal(decimal);

      expect(result).toBe('0.00000001');
    });

    it('should handle negative numbers', () => {
      const decimal = new Decimal('-123.456');
      const result = formatDecimal(decimal);

      expect(result).toBe('-123.456');
    });

    it('should truncate excess precision', () => {
      const decimal = new Decimal('123.123456789012345');
      const result = formatDecimal(decimal, 2);

      expect(result).toBe('123.12');
    });

    it('should handle zero decimal places', () => {
      const decimal = new Decimal('123.456');
      const result = formatDecimal(decimal, 0);

      expect(result).toBe('123');
    });
  });

  describe('addMoney', () => {
    it('should add money with same currency', () => {
      const a = createMoney('100', 'USD');
      const b = createMoney('50', 'USD');
      const result = addMoney(a, b);

      expect(result.amount.toString()).toBe('150');
      expect(result.currency.toString()).toBe('USD');
    });

    it('should throw error for different currencies', () => {
      const a = createMoney('100', 'USD');
      const b = createMoney('50', 'EUR');

      expect(() => addMoney(a, b)).toThrow('Cannot add different currencies');
    });

    it('should handle negative amounts', () => {
      const a = createMoney('100', 'BTC');
      const b = createMoney('-50', 'BTC');
      const result = addMoney(a, b);

      expect(result.amount.toString()).toBe('50');
    });

    it('should handle zero values', () => {
      const a = createMoney('100', 'ETH');
      const b = createMoney('0', 'ETH');
      const result = addMoney(a, b);

      expect(result.amount.toString()).toBe('100');
    });

    it('should preserve precision', () => {
      const a = createMoney('0.00000001', 'BTC');
      const b = createMoney('0.00000002', 'BTC');
      const result = addMoney(a, b);

      expect(result.amount.toFixed()).toBe('0.00000003');
    });

    it('should handle very large amounts', () => {
      const a = createMoney('999999999999', 'SHIB');
      const b = createMoney('1', 'SHIB');
      const result = addMoney(a, b);

      expect(result.amount.toString()).toBe('1000000000000');
    });
  });

  describe('subtractMoney', () => {
    it('should subtract money with same currency', () => {
      const a = createMoney('100', 'USD');
      const b = createMoney('50', 'USD');
      const result = subtractMoney(a, b);

      expect(result.amount.toString()).toBe('50');
      expect(result.currency.toString()).toBe('USD');
    });

    it('should throw error for different currencies', () => {
      const a = createMoney('100', 'USD');
      const b = createMoney('50', 'EUR');

      expect(() => subtractMoney(a, b)).toThrow('Cannot subtract different currencies');
    });

    it('should handle negative results', () => {
      const a = createMoney('50', 'BTC');
      const b = createMoney('100', 'BTC');
      const result = subtractMoney(a, b);

      expect(result.amount.toString()).toBe('-50');
    });

    it('should handle zero values', () => {
      const a = createMoney('100', 'ETH');
      const b = createMoney('0', 'ETH');
      const result = subtractMoney(a, b);

      expect(result.amount.toString()).toBe('100');
    });

    it('should preserve precision', () => {
      const a = createMoney('0.00000003', 'BTC');
      const b = createMoney('0.00000001', 'BTC');
      const result = subtractMoney(a, b);

      expect(result.amount.toFixed()).toBe('0.00000002');
    });

    it('should result in zero when subtracting equal amounts', () => {
      const a = createMoney('100', 'USD');
      const b = createMoney('100', 'USD');
      const result = subtractMoney(a, b);

      expect(result.amount.isZero()).toBe(true);
    });
  });

  describe('moneyEquals', () => {
    it('should return true for equal Money objects', () => {
      const a = createMoney('100', 'USD');
      const b = createMoney('100', 'USD');

      expect(moneyEquals(a, b)).toBe(true);
    });

    it('should return false for different amounts', () => {
      const a = createMoney('100', 'USD');
      const b = createMoney('200', 'USD');

      expect(moneyEquals(a, b)).toBe(false);
    });

    it('should return false for different currencies', () => {
      const a = createMoney('100', 'USD');
      const b = createMoney('100', 'EUR');

      expect(moneyEquals(a, b)).toBe(false);
    });

    it('should return true when both are undefined', () => {
      expect(moneyEquals()).toBe(true);
    });

    it('should return false when one is undefined', () => {
      const money = createMoney('100', 'USD');

      expect(moneyEquals(money)).toBe(false);
      expect(moneyEquals(undefined, money)).toBe(false);
    });

    it('should handle zero values', () => {
      const a = createMoney('0', 'USD');
      const b = createMoney('0', 'USD');

      expect(moneyEquals(a, b)).toBe(true);
    });

    it('should handle negative values', () => {
      const a = createMoney('-100', 'BTC');
      const b = createMoney('-100', 'BTC');

      expect(moneyEquals(a, b)).toBe(true);
    });

    it('should handle high precision values', () => {
      const a = createMoney('0.123456789012345678', 'ETH');
      const b = createMoney('0.123456789012345678', 'ETH');

      expect(moneyEquals(a, b)).toBe(true);
    });

    it('should detect small differences in precision', () => {
      const a = createMoney('0.123456789012345678', 'ETH');
      const b = createMoney('0.123456789012345679', 'ETH');

      expect(moneyEquals(a, b)).toBe(false);
    });
  });

  describe('isZeroMoney', () => {
    it('should return true for zero money', () => {
      const money = createMoney('0', 'USD');

      expect(isZeroMoney(money)).toBe(true);
    });

    it('should return true for undefined', () => {
      expect(isZeroMoney()).toBe(true);
    });

    it('should return false for non-zero money', () => {
      const money = createMoney('100', 'USD');

      expect(isZeroMoney(money)).toBe(false);
    });

    it('should return false for negative money', () => {
      const money = createMoney('-100', 'USD');

      expect(isZeroMoney(money)).toBe(false);
    });

    it('should handle very small non-zero values', () => {
      const money = createMoney('0.00000001', 'BTC');

      expect(isZeroMoney(money)).toBe(false);
    });

    it('should handle zero with different representations', () => {
      expect(isZeroMoney(createMoney('0.0', 'USD'))).toBe(true);
      expect(isZeroMoney(createMoney('0.00', 'USD'))).toBe(true);
      expect(isZeroMoney(createMoney('-0', 'USD'))).toBe(true);
    });
  });

  describe('decimalToString', () => {
    it('should convert Decimal to string', () => {
      const decimal = new Decimal('123.456');
      const result = decimalToString(decimal);

      expect(result).toBe('123.456');
    });

    it('should return undefined for undefined input', () => {
      const result = decimalToString();

      expect(result).toBeUndefined();
    });

    it('should preserve full precision', () => {
      const decimal = new Decimal('0.123456789012345678901234567890');
      const result = decimalToString(decimal);

      expect(result).toContain('0.12345678901234567890123456789');
    });

    it('should handle zero', () => {
      const decimal = new Decimal('0');
      const result = decimalToString(decimal);

      expect(result).toBe('0');
    });

    it('should handle negative numbers', () => {
      const decimal = new Decimal('-123.456');
      const result = decimalToString(decimal);

      expect(result).toBe('-123.456');
    });

    it('should handle very large numbers without scientific notation', () => {
      const decimal = new Decimal('999999999999999999');
      const result = decimalToString(decimal);

      expect(result).toBe('999999999999999999');
      expect(result).not.toContain('e');
    });

    it('should handle very small numbers without scientific notation', () => {
      const decimal = new Decimal('0.00000001');
      const result = decimalToString(decimal);

      expect(result).toBe('0.00000001');
      expect(result).not.toContain('e');
    });
  });

  describe('stringToDecimal', () => {
    it('should convert string to Decimal', () => {
      const result = stringToDecimal('123.456');

      expect(result.toString()).toBe('123.456');
    });

    it('should return zero for undefined', () => {
      const result = stringToDecimal();

      expect(result.isZero()).toBe(true);
    });

    it('should return zero for empty string', () => {
      const result = stringToDecimal('');

      expect(result.isZero()).toBe(true);
    });

    it('should handle negative numbers', () => {
      const result = stringToDecimal('-456.789');

      expect(result.toString()).toBe('-456.789');
    });

    it('should preserve full precision', () => {
      const result = stringToDecimal('0.123456789012345678901234567890');

      expect(result.toString()).toContain('0.12345678901234567890123456789');
    });

    it('should handle zero', () => {
      const result = stringToDecimal('0');

      expect(result.isZero()).toBe(true);
    });

    it('should handle very large numbers', () => {
      const result = stringToDecimal('999999999999999999');

      expect(result.toString()).toBe('999999999999999999');
    });
  });

  describe('moneyToDbString', () => {
    it('should convert Money to string', () => {
      const money = createMoney('123.456', 'USD');
      const result = moneyToDbString(money);

      expect(result).toBe('123.456');
    });

    it('should return undefined for undefined Money', () => {
      const result = moneyToDbString();

      expect(result).toBeUndefined();
    });

    it('should preserve full precision', () => {
      const money = createMoney('0.123456789012345678901234567890', 'BTC');
      const result = moneyToDbString(money);

      expect(result).toContain('0.12345678901234567890123456789');
    });

    it('should handle zero', () => {
      const money = createMoney('0', 'USD');
      const result = moneyToDbString(money);

      expect(result).toBe('0');
    });

    it('should handle negative amounts', () => {
      const money = createMoney('-123.456', 'EUR');
      const result = moneyToDbString(money);

      expect(result).toBe('-123.456');
    });
  });

  describe('dbStringToMoney', () => {
    it('should convert database strings to Money', () => {
      const result = dbStringToMoney('123.456', 'USD');

      expect(result?.amount.toString()).toBe('123.456');
      expect(result?.currency.toString()).toBe('USD');
    });

    it('should return undefined for null amount', () => {
      const result = dbStringToMoney(null, 'USD');

      expect(result).toBeUndefined();
    });

    it('should return undefined for null currency', () => {
      const result = dbStringToMoney('123.456', null);

      expect(result).toBeUndefined();
    });

    it('should return undefined when both are null', () => {
      const result = dbStringToMoney(null, null);

      expect(result).toBeUndefined();
    });

    it('should preserve full precision', () => {
      const result = dbStringToMoney('0.123456789012345678901234567890', 'BTC');

      expect(result?.amount.toString()).toContain('0.12345678901234567890123456789');
    });

    it('should handle zero', () => {
      const result = dbStringToMoney('0', 'USD');

      expect(result?.amount.isZero()).toBe(true);
    });

    it('should handle negative amounts', () => {
      const result = dbStringToMoney('-123.456', 'EUR');

      expect(result?.amount.toString()).toBe('-123.456');
    });

    it('should normalize currency', () => {
      const result = dbStringToMoney('100', 'btc');

      expect(result?.currency.toString()).toBe('BTC');
    });
  });

  describe('Database round-trip', () => {
    it('should preserve Money through database conversion', () => {
      const original = createMoney('123.456789012345678', 'BTC');
      const dbString = moneyToDbString(original);
      const restored = dbStringToMoney(dbString!, original.currency.toString());

      expect(moneyEquals(original, restored)).toBe(true);
    });

    it('should preserve zero through database conversion', () => {
      const original = createMoney('0', 'USD');
      const dbString = moneyToDbString(original);
      const restored = dbStringToMoney(dbString!, original.currency.toString());

      expect(moneyEquals(original, restored)).toBe(true);
    });

    it('should preserve negative values through database conversion', () => {
      const original = createMoney('-999.999', 'EUR');
      const dbString = moneyToDbString(original);
      const restored = dbStringToMoney(dbString!, original.currency.toString());

      expect(moneyEquals(original, restored)).toBe(true);
    });
  });
});

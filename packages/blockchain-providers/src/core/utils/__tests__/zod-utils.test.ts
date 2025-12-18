import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  hexOrNumericToNumericOptional,
  hexOrNumericToNumericRequired,
  parseApiBoolean,
  timestampToDate,
} from '../zod-utils.ts';

describe('zod-utils', () => {
  describe('hexOrNumericToNumericOptional', () => {
    it('should convert hex strings to numeric strings', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      expect(schema.parse({ value: '0x0' }).value).toBe('0');
      expect(schema.parse({ value: '0x12' }).value).toBe('18');
      expect(schema.parse({ value: '0xFF' }).value).toBe('255');
      expect(schema.parse({ value: '0xff' }).value).toBe('255');
      expect(schema.parse({ value: '0xABCD' }).value).toBe('43981');
    });

    it('should handle very large hex values without scientific notation', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      // Large hex value that would be in scientific notation
      expect(schema.parse({ value: '0xFFFFFFFFFFFFFFFF' }).value).toBe('18446744073709551615');
      expect(schema.parse({ value: '0x1234567890ABCDEF' }).value).toBe('1311768467294899695');
    });

    it('should convert numeric strings to numeric strings', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      expect(schema.parse({ value: '0' }).value).toBe('0');
      expect(schema.parse({ value: '123' }).value).toBe('123');
      expect(schema.parse({ value: '999999999999' }).value).toBe('999999999999');
    });

    it('should convert numbers to numeric strings', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      expect(schema.parse({ value: 0 }).value).toBe('0');
      expect(schema.parse({ value: 123 }).value).toBe('123');
      expect(schema.parse({ value: 999999 }).value).toBe('999999');
    });

    it('should handle null values', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      expect(schema.parse({ value: undefined }).value).toBeUndefined();
    });

    it('should handle optional/undefined values', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      expect(schema.parse({}).value).toBeUndefined();
    });

    it('should reject negative numbers', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      expect(() => schema.parse({ value: -1 })).toThrow();
    });

    it('should reject invalid hex strings', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      expect(() => schema.parse({ value: '0xGGG' })).toThrow();
      expect(() => schema.parse({ value: '0x' })).toThrow();
      expect(() => schema.parse({ value: 'ABCD' })).toThrow(); // Missing 0x prefix
    });

    it('should reject numeric strings with non-digits', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      expect(() => schema.parse({ value: '123abc' })).toThrow();
      expect(() => schema.parse({ value: '12.34' })).toThrow();
      expect(() => schema.parse({ value: '1e5' })).toThrow();
    });

    it('should handle decimal values converted from hex', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      // When dealing with very small decimal values (like wei to ETH)
      // The hex value might represent a decimal
      expect(schema.parse({ value: '0x1' }).value).toBe('1');
    });

    it('should handle very large numbers without scientific notation', () => {
      const schema = z.object({ value: hexOrNumericToNumericOptional });

      // Very large number that would normally be in scientific notation
      const largeNumber = '999999999999999999999999999999';
      expect(schema.parse({ value: largeNumber }).value).toBe(largeNumber);
    });
  });

  describe('hexOrNumericToNumericRequired', () => {
    it('should convert hex strings to numeric strings', () => {
      const schema = z.object({ value: hexOrNumericToNumericRequired });

      expect(schema.parse({ value: '0x0' }).value).toBe('0');
      expect(schema.parse({ value: '0x12' }).value).toBe('18');
      expect(schema.parse({ value: '0xFF' }).value).toBe('255');
      expect(schema.parse({ value: '0xABCD' }).value).toBe('43981');
    });

    it('should convert numeric strings to numeric strings', () => {
      const schema = z.object({ value: hexOrNumericToNumericRequired });

      expect(schema.parse({ value: '0' }).value).toBe('0');
      expect(schema.parse({ value: '123' }).value).toBe('123');
      expect(schema.parse({ value: '999999999999' }).value).toBe('999999999999');
    });

    it('should convert numbers to numeric strings', () => {
      const schema = z.object({ value: hexOrNumericToNumericRequired });

      expect(schema.parse({ value: 0 }).value).toBe('0');
      expect(schema.parse({ value: 123 }).value).toBe('123');
      expect(schema.parse({ value: 999999 }).value).toBe('999999');
    });

    it('should reject null values', () => {
      const schema = z.object({ value: hexOrNumericToNumericRequired });

      expect(() => schema.parse({ value: undefined })).toThrow();
    });

    it('should reject undefined values', () => {
      const schema = z.object({ value: hexOrNumericToNumericRequired });

      expect(() => schema.parse({})).toThrow();
    });

    it('should handle very large hex values without scientific notation', () => {
      const schema = z.object({ value: hexOrNumericToNumericRequired });

      expect(schema.parse({ value: '0xFFFFFFFFFFFFFFFF' }).value).toBe('18446744073709551615');
    });

    it('should reject negative numbers', () => {
      const schema = z.object({ value: hexOrNumericToNumericRequired });

      expect(() => schema.parse({ value: -1 })).toThrow();
    });

    it('should reject invalid formats', () => {
      const schema = z.object({ value: hexOrNumericToNumericRequired });

      expect(() => schema.parse({ value: '0xGGG' })).toThrow();
      expect(() => schema.parse({ value: '123abc' })).toThrow();
      expect(() => schema.parse({ value: '12.34' })).toThrow();
    });
  });

  describe('parseApiBoolean', () => {
    describe('boolean inputs', () => {
      it('should return true for boolean true', () => {
        expect(parseApiBoolean(true)).toBe(true);
      });

      it('should return false for boolean false', () => {
        expect(parseApiBoolean(false)).toBe(false);
      });
    });

    describe('string inputs - lowercase', () => {
      it('should return true for "true"', () => {
        expect(parseApiBoolean('true')).toBe(true);
      });

      it('should return false for "false"', () => {
        expect(parseApiBoolean('false')).toBe(false);
      });

      it('should return true for "1"', () => {
        expect(parseApiBoolean('1')).toBe(true);
      });

      it('should return false for "0"', () => {
        expect(parseApiBoolean('0')).toBe(false);
      });
    });

    describe('string inputs - uppercase (case-insensitive)', () => {
      it('should return true for "True"', () => {
        expect(parseApiBoolean('True')).toBe(true);
      });

      it('should return true for "TRUE"', () => {
        expect(parseApiBoolean('TRUE')).toBe(true);
      });

      it('should return false for "False"', () => {
        expect(parseApiBoolean('False')).toBe(false);
      });

      it('should return false for "FALSE"', () => {
        expect(parseApiBoolean('FALSE')).toBe(false);
      });

      it('should return true for "TrUe" (mixed case)', () => {
        expect(parseApiBoolean('TrUe')).toBe(true);
      });

      it('should return false for "FaLsE" (mixed case)', () => {
        expect(parseApiBoolean('FaLsE')).toBe(false);
      });
    });

    describe('null and undefined inputs', () => {
      it('should return undefined for null', () => {
        // eslint-disable-next-line unicorn/no-null -- needed for test
        expect(parseApiBoolean(null)).toBeUndefined();
      });

      it('should return undefined for undefined', () => {
        expect(parseApiBoolean(undefined)).toBeUndefined();
      });
    });

    describe('invalid inputs', () => {
      it('should return undefined for invalid string', () => {
        expect(parseApiBoolean('invalid')).toBeUndefined();
      });

      it('should return undefined for empty string', () => {
        expect(parseApiBoolean('')).toBeUndefined();
      });

      it('should return undefined for random text', () => {
        expect(parseApiBoolean('yes')).toBeUndefined();
        expect(parseApiBoolean('no')).toBeUndefined();
        expect(parseApiBoolean('Y')).toBeUndefined();
        expect(parseApiBoolean('N')).toBeUndefined();
      });
    });
  });

  describe('timestampToDate', () => {
    describe('number inputs', () => {
      it('should convert Unix timestamp in seconds to Date', () => {
        const schema = z.object({ date: timestampToDate });

        // January 1, 2021 00:00:00 UTC
        const result = schema.parse({ date: 1609459200 });
        expect(result.date).toBeInstanceOf(Date);
        expect(result.date.getTime()).toBe(1609459200000);
        expect(result.date.toISOString()).toBe('2021-01-01T00:00:00.000Z');
      });

      it('should convert Unix timestamp in milliseconds to Date', () => {
        const schema = z.object({ date: timestampToDate });

        // January 1, 2021 00:00:00 UTC
        const result = schema.parse({ date: 1609459200000 });
        expect(result.date).toBeInstanceOf(Date);
        expect(result.date.getTime()).toBe(1609459200000);
      });

      it('should detect and handle millisecond timestamps correctly', () => {
        const schema = z.object({ date: timestampToDate });

        // Timestamp > 10000000000 is treated as milliseconds
        const millisecondsTimestamp = 16094592000000;
        const result = schema.parse({ date: millisecondsTimestamp });
        expect(result.date.getTime()).toBe(millisecondsTimestamp);
      });

      it('should handle very recent timestamps', () => {
        const schema = z.object({ date: timestampToDate });

        // November 2024
        const result = schema.parse({ date: 1730419200 });
        expect(result.date.getUTCFullYear()).toBe(2024);
        expect(result.date.getUTCMonth()).toBe(10); // November (0-indexed)
      });

      it('should handle early Unix timestamps', () => {
        const schema = z.object({ date: timestampToDate });

        // January 1, 1970 00:00:01 UTC
        const result = schema.parse({ date: 1 });
        expect(result.date.getTime()).toBe(1000);
      });

      it('should handle zero timestamp', () => {
        const schema = z.object({ date: timestampToDate });

        const result = schema.parse({ date: 0 });
        expect(result.date.getTime()).toBe(0);
        expect(result.date.toISOString()).toBe('1970-01-01T00:00:00.000Z');
      });
    });

    describe('string inputs', () => {
      it('should convert numeric timestamp strings in seconds to Date', () => {
        const schema = z.object({ date: timestampToDate });

        const result = schema.parse({ date: '1609459200' });
        expect(result.date).toBeInstanceOf(Date);
        expect(result.date.getTime()).toBe(1609459200000);
      });

      it('should convert numeric timestamp strings in milliseconds to Date', () => {
        const schema = z.object({ date: timestampToDate });

        const result = schema.parse({ date: '1609459200000' });
        expect(result.date.getTime()).toBe(1609459200000);
      });

      it('should parse ISO 8601 date strings', () => {
        const schema = z.object({ date: timestampToDate });

        const result = schema.parse({ date: '2021-01-01T00:00:00.000Z' });
        expect(result.date).toBeInstanceOf(Date);
        expect(result.date.toISOString()).toBe('2021-01-01T00:00:00.000Z');
      });

      it('should parse ISO 8601 date strings with timezone', () => {
        const schema = z.object({ date: timestampToDate });

        const result = schema.parse({ date: '2021-01-01T10:30:00+05:30' });
        expect(result.date).toBeInstanceOf(Date);
        expect(result.date.toISOString()).toBe('2021-01-01T05:00:00.000Z');
      });

      it('should parse UTC date format strings', () => {
        const schema = z.object({ date: timestampToDate });

        const result = schema.parse({ date: '2021-01-01 00:00:00.000 +0000 UTC' });
        expect(result.date).toBeInstanceOf(Date);
        // Just check it's a valid date
        expect(result.date.getUTCFullYear()).toBe(2021);
      });

      it('should parse common date string formats', () => {
        const schema = z.object({ date: timestampToDate });

        // Various formats that Date constructor should handle
        expect(schema.parse({ date: 'January 1, 2021' }).date).toBeInstanceOf(Date);
        expect(schema.parse({ date: '2021-01-01' }).date).toBeInstanceOf(Date);
        expect(schema.parse({ date: '01/01/2021' }).date).toBeInstanceOf(Date);
      });

      it('should throw error for invalid date strings', () => {
        const schema = z.object({ date: timestampToDate });

        expect(() => schema.parse({ date: 'invalid date' })).toThrow(/Invalid timestamp format/);
        expect(() => schema.parse({ date: '' })).toThrow(/Invalid timestamp format/);
        expect(() => schema.parse({ date: 'xyz123' })).toThrow(/Invalid timestamp format/);
      });

      it('should handle ISO 8601 strings without leading/trailing whitespace', () => {
        const schema = z.object({ date: timestampToDate });

        const result = schema.parse({ date: '2021-01-01T00:00:00.000Z' });
        expect(result.date).toBeInstanceOf(Date);
        expect(result.date.toISOString()).toBe('2021-01-01T00:00:00.000Z');
      });
    });

    describe('Date object inputs', () => {
      it('should return Date objects as-is', () => {
        const schema = z.object({ date: timestampToDate });

        const inputDate = new Date('2021-01-01T00:00:00.000Z');
        const result = schema.parse({ date: inputDate });
        expect(result.date).toBe(inputDate);
        expect(result.date.toISOString()).toBe('2021-01-01T00:00:00.000Z');
      });

      it('should handle Date objects with different times', () => {
        const schema = z.object({ date: timestampToDate });

        const now = new Date();
        const result = schema.parse({ date: now });
        expect(result.date).toBe(now);
      });
    });

    describe('edge cases', () => {
      it('should reject negative timestamps', () => {
        const schema = z.object({ date: timestampToDate });

        expect(() => schema.parse({ date: -1 })).toThrow();
      });

      it('should handle very large timestamps', () => {
        const schema = z.object({ date: timestampToDate });

        // Far future timestamp (year 2100)
        const result = schema.parse({ date: 4102444800 });
        expect(result.date).toBeInstanceOf(Date);
        expect(result.date.getUTCFullYear()).toBeGreaterThanOrEqual(2100);
      });

      it('should handle blockchain-typical timestamps', () => {
        const schema = z.object({ date: timestampToDate });

        // Bitcoin genesis block timestamp (January 3, 2009)
        const genesisResult = schema.parse({ date: 1231006505 });
        expect(genesisResult.date.getUTCFullYear()).toBe(2009);

        // Ethereum genesis block timestamp (July 30, 2015)
        const ethGenesisResult = schema.parse({ date: 1438269988 });
        expect(ethGenesisResult.date.getUTCFullYear()).toBe(2015);
      });

      it('should correctly distinguish seconds vs milliseconds timestamps', () => {
        const schema = z.object({ date: timestampToDate });

        // 10000000000 is the boundary (September 9, 2001)
        // Just below boundary - should be treated as seconds
        const secondsResult = schema.parse({ date: 9999999999 });
        expect(secondsResult.date.getTime()).toBe(9999999999000);

        // Just above boundary - should be treated as milliseconds
        const millisecondsResult = schema.parse({ date: 10000000001 });
        expect(millisecondsResult.date.getTime()).toBe(10000000001);
      });

      it('should handle the boundary timestamp exactly', () => {
        const schema = z.object({ date: timestampToDate });

        // Exactly at boundary
        const boundaryResult = schema.parse({ date: 10000000000 });
        expect(boundaryResult.date.getTime()).toBe(10000000000000);
      });
    });

    describe('real-world blockchain scenarios', () => {
      it('should handle Ethereum block timestamps', () => {
        const schema = z.object({ date: timestampToDate });

        // Typical Ethereum block timestamp (seconds)
        const result = schema.parse({ date: 1609459200 });
        expect(result.date).toBeInstanceOf(Date);
      });

      it('should handle Solana slot timestamps', () => {
        const schema = z.object({ date: timestampToDate });

        // Solana timestamps are often in milliseconds
        const result = schema.parse({ date: 1609459200000 });
        expect(result.date.getTime()).toBe(1609459200000);
      });

      it('should handle API response timestamp strings', () => {
        const schema = z.object({ date: timestampToDate });

        // Common API timestamp formats
        expect(schema.parse({ date: '2021-01-01T00:00:00Z' }).date).toBeInstanceOf(Date);
        expect(schema.parse({ date: '2021-01-01T00:00:00.000Z' }).date).toBeInstanceOf(Date);
        expect(schema.parse({ date: '1609459200' }).date).toBeInstanceOf(Date);
      });
    });
  });
});

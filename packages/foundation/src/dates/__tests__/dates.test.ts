import { describe, expect, it } from 'vitest';

import { DateSchema, pickLatestDate } from '../dates.js';

describe('dates', () => {
  describe('pickLatestDate', () => {
    it('returns undefined when all dates are undefined', () => {
      expect(pickLatestDate(undefined, undefined)).toBeUndefined();
    });

    it('returns the latest defined date', () => {
      const early = new Date('2024-01-01T00:00:00.000Z');
      const late = new Date('2024-01-02T00:00:00.000Z');

      expect(pickLatestDate(early, undefined, late)).toBe(late);
    });
  });

  describe('DateSchema', () => {
    it('parses unix timestamps into Date instances', () => {
      const value = DateSchema.parse(1704067200000);

      expect(value).toBeInstanceOf(Date);
      expect(value.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('parses ISO strings into Date instances', () => {
      const value = DateSchema.parse('2024-01-01T00:00:00.000Z');

      expect(value).toBeInstanceOf(Date);
      expect(value.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('preserves Date instances', () => {
      const input = new Date('2024-01-01T00:00:00.000Z');

      expect(DateSchema.parse(input)).toBe(input);
    });

    it('rejects invalid date strings', () => {
      expect(() => DateSchema.parse('not-a-date')).toThrow('Invalid date string');
    });
  });
});

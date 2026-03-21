import { describe, expect, it } from 'vitest';

import { isSameDay, roundToDay } from '../time-buckets.js';

describe('price-cache/time-buckets', () => {
  describe('roundToDay', () => {
    it('should round down to start of day in UTC', () => {
      const date = new Date('2024-01-15T14:30:45.123Z');
      const rounded = roundToDay(date);

      expect(rounded.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    });

    it('should not modify dates already at start of day', () => {
      const date = new Date('2024-01-15T00:00:00.000Z');
      const rounded = roundToDay(date);

      expect(rounded.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    });
  });

  describe('isSameDay', () => {
    it('should return true for dates on same day', () => {
      const date1 = new Date('2024-01-15T10:00:00.000Z');
      const date2 = new Date('2024-01-15T20:00:00.000Z');

      expect(isSameDay(date1, date2)).toBe(true);
    });

    it('should return false for dates on different days', () => {
      const date1 = new Date('2024-01-15T23:59:59.999Z');
      const date2 = new Date('2024-01-16T00:00:00.000Z');

      expect(isSameDay(date1, date2)).toBe(false);
    });
  });
});

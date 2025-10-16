import { describe, expect, it } from 'vitest';

import { buildViewMeta, parseDate } from '../view-utils.ts';

describe('view-utils', () => {
  describe('parseDate', () => {
    it('should parse valid ISO date string', () => {
      const date = parseDate('2024-01-15');
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toContain('2024-01-15');
    });

    it('should parse ISO datetime string with time', () => {
      const date = parseDate('2024-06-15T10:30:00Z');
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toBe('2024-06-15T10:30:00.000Z');
    });

    it('should parse date with timezone', () => {
      const date = parseDate('2024-03-20T14:30:00-05:00');
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2024);
    });

    it('should throw error for invalid date format', () => {
      expect(() => parseDate('not-a-date')).toThrow('Invalid date format: not-a-date');
    });

    it('should throw error for empty string', () => {
      expect(() => parseDate('')).toThrow('Invalid date format: ');
    });

    it('should throw error for partial date', () => {
      expect(() => parseDate('2024-13-01')).toThrow('Invalid date format: 2024-13-01');
    });
  });

  describe('buildViewMeta', () => {
    it('should build metadata with hasMore true when more results available', () => {
      const meta = buildViewMeta(50, 0, 50, 100);

      expect(meta.count).toBe(50);
      expect(meta.offset).toBe(0);
      expect(meta.limit).toBe(50);
      expect(meta.hasMore).toBe(true);
      expect(meta.filters).toBeUndefined();
    });

    it('should build metadata with hasMore false when no more results', () => {
      const meta = buildViewMeta(30, 0, 50, 30);

      expect(meta.count).toBe(30);
      expect(meta.offset).toBe(0);
      expect(meta.limit).toBe(50);
      expect(meta.hasMore).toBe(false);
    });

    it('should handle pagination with offset', () => {
      const meta = buildViewMeta(25, 50, 25, 100);

      expect(meta.count).toBe(25);
      expect(meta.offset).toBe(50);
      expect(meta.limit).toBe(25);
      expect(meta.hasMore).toBe(true); // 50 + 25 = 75 < 100
    });

    it('should handle last page with partial results', () => {
      const meta = buildViewMeta(10, 90, 50, 100);

      expect(meta.count).toBe(10);
      expect(meta.offset).toBe(90);
      expect(meta.limit).toBe(50);
      expect(meta.hasMore).toBe(false); // 90 + 10 = 100
    });

    it('should include filters when provided', () => {
      const filters = { source: 'kraken', asset: 'BTC' };
      const meta = buildViewMeta(20, 0, 50, 20, filters);

      expect(meta.filters).toEqual(filters);
    });

    it('should handle empty results', () => {
      const meta = buildViewMeta(0, 0, 50, 0);

      expect(meta.count).toBe(0);
      expect(meta.hasMore).toBe(false);
    });

    it('should handle exact page boundary', () => {
      const meta = buildViewMeta(50, 0, 50, 50);

      expect(meta.count).toBe(50);
      expect(meta.hasMore).toBe(false); // 0 + 50 = 50 (exactly totalCount)
    });

    it('should work with complex filter objects', () => {
      const filters = {
        source: 'kraken',
        asset: 'BTC',
        since: '2024-01-01',
        status: 'completed',
        limit: 100,
      };

      const meta = buildViewMeta(15, 0, 100, 15, filters);

      expect(meta.filters).toEqual(filters);
      expect(meta.count).toBe(15);
    });
  });
});

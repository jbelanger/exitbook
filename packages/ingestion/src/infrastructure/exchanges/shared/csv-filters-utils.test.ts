import { describe, expect, it } from 'vitest';

import {
  filterCsvByField,
  filterCsvByFields,
  filterCsvByTimestamp,
  filterCsvByUid,
  groupCsvByField,
} from './csv-filters-utils.js';

describe('csv-filters-utils', () => {
  interface TestRow {
    id: number;
    name: string;
    status: string;
    UID: string;
  }

  interface TimestampRow {
    id: number;
    timestamp: number;
    value: string;
  }

  describe('filterCsvByField', () => {
    const rows: TestRow[] = [
      { id: 1, name: 'Alice', status: 'active', UID: 'user1' },
      { id: 2, name: 'Bob', status: 'inactive', UID: 'user2' },
      { id: 3, name: 'Charlie', status: 'active', UID: 'user3' },
      { id: 4, name: 'Dave', status: 'pending', UID: 'user4' },
    ];

    it('should filter rows by field value', () => {
      const result = filterCsvByField(rows, 'status', 'active');

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('Alice');
      expect(result[1]?.name).toBe('Charlie');
    });

    it('should return all rows when value is undefined', () => {
      const result = filterCsvByField(rows, 'status');

      expect(result).toHaveLength(4);
      expect(result).toEqual(rows);
    });

    it('should return all rows when value is null', () => {
      const result = filterCsvByField(rows, 'status', undefined as unknown as string);

      expect(result).toHaveLength(4);
      expect(result).toEqual(rows);
    });

    it('should return empty array when no matches found', () => {
      const result = filterCsvByField(rows, 'status', 'archived');

      expect(result).toHaveLength(0);
    });

    it('should filter by numeric field', () => {
      const result = filterCsvByField(rows, 'id', 2);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Bob');
    });

    it('should filter by string field', () => {
      const result = filterCsvByField(rows, 'name', 'Charlie');

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(3);
    });

    it('should handle empty input array', () => {
      const result = filterCsvByField<TestRow, 'status'>([], 'status', 'active');

      expect(result).toHaveLength(0);
    });

    it('should maintain original order of matching rows', () => {
      const result = filterCsvByField(rows, 'status', 'active');

      expect(result[0]?.id).toBe(1);
      expect(result[1]?.id).toBe(3);
    });
  });

  describe('filterCsvByFields', () => {
    const rows: TestRow[] = [
      { id: 1, name: 'Alice', status: 'active', UID: 'user1' },
      { id: 2, name: 'Bob', status: 'inactive', UID: 'user2' },
      { id: 3, name: 'Charlie', status: 'active', UID: 'user1' },
      { id: 4, name: 'Dave', status: 'pending', UID: 'user4' },
      { id: 5, name: 'Eve', status: 'active', UID: 'user1' },
    ];

    it('should filter rows by single filter', () => {
      const result = filterCsvByFields(rows, { status: 'active' });

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.name)).toEqual(['Alice', 'Charlie', 'Eve']);
    });

    it('should filter rows by multiple filters (AND logic)', () => {
      const result = filterCsvByFields(rows, { status: 'active', UID: 'user1' });

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.name)).toEqual(['Alice', 'Charlie', 'Eve']);
    });

    it('should return all rows when filters object is empty', () => {
      const result = filterCsvByFields(rows, {});

      expect(result).toHaveLength(5);
      expect(result).toEqual(rows);
    });

    it('should ignore undefined filter values', () => {
      const result = filterCsvByFields(rows, { status: 'active', UID: undefined });

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.name)).toEqual(['Alice', 'Charlie', 'Eve']);
    });

    it('should ignore null filter values', () => {
      const result = filterCsvByFields(rows, { status: 'active', UID: undefined });

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.name)).toEqual(['Alice', 'Charlie', 'Eve']);
    });

    it('should return empty array when no matches found', () => {
      const result = filterCsvByFields(rows, { status: 'archived' });

      expect(result).toHaveLength(0);
    });

    it('should handle numeric filters', () => {
      const result = filterCsvByFields(rows, { id: 3 });

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Charlie');
    });

    it('should handle multiple non-matching filters', () => {
      const result = filterCsvByFields(rows, { status: 'active', name: 'Bob' });

      expect(result).toHaveLength(0);
    });

    it('should handle empty input array', () => {
      const result = filterCsvByFields([], { status: 'active' });

      expect(result).toHaveLength(0);
    });

    it('should handle all filters being undefined or null', () => {
      const result = filterCsvByFields(rows, { status: undefined, UID: undefined });

      expect(result).toHaveLength(5);
      expect(result).toEqual(rows);
    });

    it('should filter by three or more fields', () => {
      const result = filterCsvByFields(rows, { status: 'active', UID: 'user1', id: 3 });

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Charlie');
    });
  });

  describe('filterCsvByTimestamp', () => {
    const rows: TimestampRow[] = [
      { id: 1, timestamp: 1000, value: 'a' },
      { id: 2, timestamp: 2000, value: 'b' },
      { id: 3, timestamp: 3000, value: 'c' },
      { id: 4, timestamp: 4000, value: 'd' },
      { id: 5, timestamp: 5000, value: 'e' },
    ];

    it('should filter rows by minimum timestamp (since)', () => {
      const result = filterCsvByTimestamp(rows, 3000);

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.id)).toEqual([3, 4, 5]);
    });

    it('should filter rows by maximum timestamp (until)', () => {
      const result = filterCsvByTimestamp(rows, undefined, 3000);

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it('should filter rows by timestamp range (since and until)', () => {
      const result = filterCsvByTimestamp(rows, 2000, 4000);

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.id)).toEqual([2, 3, 4]);
    });

    it('should return all rows when both since and until are undefined', () => {
      const result = filterCsvByTimestamp(rows);

      expect(result).toHaveLength(5);
      expect(result).toEqual(rows);
    });

    it('should exclude rows before since timestamp', () => {
      const result = filterCsvByTimestamp(rows, 2500);

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.id)).toEqual([3, 4, 5]);
    });

    it('should exclude rows after until timestamp', () => {
      const result = filterCsvByTimestamp(rows, undefined, 2500);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual([1, 2]);
    });

    it('should return empty array when no rows in range', () => {
      const result = filterCsvByTimestamp(rows, 6000, 7000);

      expect(result).toHaveLength(0);
    });

    it('should handle empty input array', () => {
      const result = filterCsvByTimestamp([], 2000, 4000);

      expect(result).toHaveLength(0);
    });

    it('should include rows with exact since timestamp', () => {
      const result = filterCsvByTimestamp(rows, 3000);

      expect(result.map((r) => r.timestamp)).toContain(3000);
    });

    it('should include rows with exact until timestamp', () => {
      const result = filterCsvByTimestamp(rows, undefined, 3000);

      expect(result.map((r) => r.timestamp)).toContain(3000);
    });

    it('should handle inverted range (since > until)', () => {
      const result = filterCsvByTimestamp(rows, 4000, 2000);

      expect(result).toHaveLength(0);
    });

    it('should handle timestamp of zero', () => {
      const rowsWithZero: TimestampRow[] = [
        { id: 1, timestamp: 0, value: 'a' },
        { id: 2, timestamp: 1000, value: 'b' },
      ];

      const result = filterCsvByTimestamp(rowsWithZero, 0, 500);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should handle negative timestamps', () => {
      const rowsWithNegative: TimestampRow[] = [
        { id: 1, timestamp: -1000, value: 'a' },
        { id: 2, timestamp: 0, value: 'b' },
        { id: 3, timestamp: 1000, value: 'c' },
      ];

      const result = filterCsvByTimestamp(rowsWithNegative, -500, 500);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(2);
    });
  });

  describe('filterCsvByUid', () => {
    const rows: TestRow[] = [
      { id: 1, name: 'Alice', status: 'active', UID: 'user1' },
      { id: 2, name: 'Bob', status: 'inactive', UID: 'user2' },
      { id: 3, name: 'Charlie', status: 'active', UID: 'user1' },
      { id: 4, name: 'Dave', status: 'pending', UID: 'user3' },
    ];

    it('should filter rows by UID', () => {
      const result = filterCsvByUid(rows, 'user1');

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.name)).toEqual(['Alice', 'Charlie']);
    });

    it('should return all rows when UID is undefined', () => {
      const result = filterCsvByUid(rows);

      expect(result).toHaveLength(4);
      expect(result).toEqual(rows);
    });

    it('should return empty array when no matching UID found', () => {
      const result = filterCsvByUid(rows, 'user999');

      expect(result).toHaveLength(0);
    });

    it('should handle empty input array', () => {
      const result = filterCsvByUid([], 'user1');

      expect(result).toHaveLength(0);
    });

    it('should filter single matching row', () => {
      const result = filterCsvByUid(rows, 'user2');

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Bob');
    });
  });

  describe('groupCsvByField', () => {
    const rows: TestRow[] = [
      { id: 1, name: 'Alice', status: 'active', UID: 'user1' },
      { id: 2, name: 'Bob', status: 'inactive', UID: 'user2' },
      { id: 3, name: 'Charlie', status: 'active', UID: 'user1' },
      { id: 4, name: 'Dave', status: 'pending', UID: 'user3' },
      { id: 5, name: 'Eve', status: 'active', UID: 'user1' },
    ];

    it('should group rows by field value', () => {
      const result = groupCsvByField(rows, 'status');

      expect(result.size).toBe(3);
      expect(result.get('active')).toHaveLength(3);
      expect(result.get('inactive')).toHaveLength(1);
      expect(result.get('pending')).toHaveLength(1);
    });

    it('should group rows by UID field', () => {
      const result = groupCsvByField(rows, 'UID');

      expect(result.size).toBe(3);
      expect(result.get('user1')).toHaveLength(3);
      expect(result.get('user2')).toHaveLength(1);
      expect(result.get('user3')).toHaveLength(1);
    });

    it('should group rows by numeric field', () => {
      const result = groupCsvByField(rows, 'id');

      expect(result.size).toBe(5);
      expect(result.get(1)).toHaveLength(1);
      expect(result.get(2)).toHaveLength(1);
      expect(result.get(3)).toHaveLength(1);
      expect(result.get(4)).toHaveLength(1);
      expect(result.get(5)).toHaveLength(1);
    });

    it('should preserve order within groups', () => {
      const result = groupCsvByField(rows, 'status');

      const activeGroup = result.get('active');
      expect(activeGroup?.map((r) => r.id)).toEqual([1, 3, 5]);
    });

    it('should handle empty input array', () => {
      const result = groupCsvByField([], 'status');

      expect(result.size).toBe(0);
    });

    it('should handle all rows having same field value', () => {
      const sameStatusRows: TestRow[] = [
        { id: 1, name: 'Alice', status: 'active', UID: 'user1' },
        { id: 2, name: 'Bob', status: 'active', UID: 'user2' },
        { id: 3, name: 'Charlie', status: 'active', UID: 'user3' },
      ];

      const result = groupCsvByField(sameStatusRows, 'status');

      expect(result.size).toBe(1);
      expect(result.get('active')).toHaveLength(3);
    });

    it('should handle all rows having unique field values', () => {
      const result = groupCsvByField(rows, 'name');

      expect(result.size).toBe(5);
      expect(result.get('Alice')).toHaveLength(1);
      expect(result.get('Bob')).toHaveLength(1);
      expect(result.get('Charlie')).toHaveLength(1);
      expect(result.get('Dave')).toHaveLength(1);
      expect(result.get('Eve')).toHaveLength(1);
    });

    it('should return Map instance', () => {
      const result = groupCsvByField(rows, 'status');

      expect(result).toBeInstanceOf(Map);
    });

    it('should allow iteration over grouped results', () => {
      const result = groupCsvByField(rows, 'status');
      const statuses: string[] = [];

      for (const [status] of result) {
        statuses.push(status);
      }

      expect(statuses).toContain('active');
      expect(statuses).toContain('inactive');
      expect(statuses).toContain('pending');
    });

    it('should handle grouping with empty string values', () => {
      const rowsWithEmpty: TestRow[] = [
        { id: 1, name: '', status: 'active', UID: 'user1' },
        { id: 2, name: '', status: 'inactive', UID: 'user2' },
        { id: 3, name: 'Charlie', status: 'active', UID: 'user3' },
      ];

      const result = groupCsvByField(rowsWithEmpty, 'name');

      expect(result.size).toBe(2);
      expect(result.get('')).toHaveLength(2);
      expect(result.get('Charlie')).toHaveLength(1);
    });
  });
});

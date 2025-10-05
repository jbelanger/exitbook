import { describe, expect, test } from 'vitest';

import { createEmptyCursor, getCursorTimestamp, updateCursor } from '../cursor.ts';

describe('Exchange Cursor Utilities', () => {
  describe('createEmptyCursor', () => {
    test('should create an empty cursor object', () => {
      const cursor = createEmptyCursor();
      expect(cursor).toEqual({});
    });
  });

  describe('updateCursor', () => {
    test('should add a new operation type to empty cursor', () => {
      const cursor = createEmptyCursor();
      const updated = updateCursor(cursor, 'trade', 1704067200000);

      expect(updated).toEqual({
        trade: 1704067200000,
      });
    });

    test('should update existing operation type timestamp', () => {
      const cursor = { trade: 1704067200000 };
      const updated = updateCursor(cursor, 'trade', 1704070800000);

      expect(updated).toEqual({
        trade: 1704070800000,
      });
    });

    test('should add new operation type to existing cursor', () => {
      const cursor = { trade: 1704067200000 };
      const updated = updateCursor(cursor, 'deposit', 1704070800000);

      expect(updated).toEqual({
        deposit: 1704070800000,
        trade: 1704067200000,
      });
    });

    test('should not mutate original cursor', () => {
      const cursor = { trade: 1704067200000 };
      const updated = updateCursor(cursor, 'deposit', 1704070800000);

      expect(cursor).toEqual({ trade: 1704067200000 });
      expect(updated).not.toBe(cursor);
    });

    test('should handle multiple operation types', () => {
      let cursor = createEmptyCursor();
      cursor = updateCursor(cursor, 'trade', 1704067200000);
      cursor = updateCursor(cursor, 'deposit', 1704070800000);
      cursor = updateCursor(cursor, 'withdrawal', 1704074400000);
      cursor = updateCursor(cursor, 'order', 1704078000000);

      expect(cursor).toEqual({
        deposit: 1704070800000,
        order: 1704078000000,
        trade: 1704067200000,
        withdrawal: 1704074400000,
      });
    });
  });

  describe('getCursorTimestamp', () => {
    test('should return timestamp for existing operation type', () => {
      const cursor = { trade: 1704067200000 };
      const timestamp = getCursorTimestamp(cursor, 'trade');

      expect(timestamp).toBe(1704067200000);
    });

    test('should return undefined for non-existent operation type', () => {
      const cursor = { trade: 1704067200000 };
      const timestamp = getCursorTimestamp(cursor, 'deposit');

      expect(timestamp).toBeUndefined();
    });

    test('should return undefined for null cursor', () => {
      const timestamp = getCursorTimestamp(undefined, 'trade');

      expect(timestamp).toBeUndefined();
    });

    test('should return undefined for undefined cursor', () => {
      const timestamp = getCursorTimestamp(undefined, 'trade');

      expect(timestamp).toBeUndefined();
    });

    test('should return timestamp from cursor with multiple operations', () => {
      const cursor = {
        deposit: 1704070800000,
        order: 1704078000000,
        trade: 1704067200000,
        withdrawal: 1704074400000,
      };

      expect(getCursorTimestamp(cursor, 'trade')).toBe(1704067200000);
      expect(getCursorTimestamp(cursor, 'deposit')).toBe(1704070800000);
      expect(getCursorTimestamp(cursor, 'withdrawal')).toBe(1704074400000);
      expect(getCursorTimestamp(cursor, 'order')).toBe(1704078000000);
    });
  });

  describe('cursor immutability', () => {
    test('updateCursor should create new object references', () => {
      const cursor1 = { trade: 1704067200000 };
      const cursor2 = updateCursor(cursor1, 'deposit', 1704070800000);
      const cursor3 = updateCursor(cursor2, 'withdrawal', 1704074400000);

      expect(cursor1).toEqual({ trade: 1704067200000 });
      expect(cursor2).toEqual({ deposit: 1704070800000, trade: 1704067200000 });
      expect(cursor3).toEqual({ deposit: 1704070800000, trade: 1704067200000, withdrawal: 1704074400000 });

      expect(cursor1).not.toBe(cursor2);
      expect(cursor2).not.toBe(cursor3);
      expect(cursor1).not.toBe(cursor3);
    });
  });
});

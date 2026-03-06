/* eslint-disable unicorn/no-null -- acceptable for tests */
import { describe, expect, it } from 'vitest';

import { isCursorState, isExchangeCursor } from '../cursor-utils.js';

describe('cursor-utils', () => {
  it('identifies CursorState-shaped objects', () => {
    const cursor = {
      primary: { type: 'blockNumber', value: 12345 },
      lastTransactionId: 'tx-1',
      totalFetched: 100,
    };

    expect(isCursorState(cursor)).toBe(true);
    expect(isExchangeCursor(cursor)).toBe(false);
  });

  it('treats non-CursorState objects as exchange cursors', () => {
    const cursor = {
      page: 2,
      next: 'abc',
    };

    expect(isCursorState(cursor)).toBe(false);
    expect(isExchangeCursor(cursor)).toBe(true);
  });

  it('rejects null and primitives', () => {
    expect(isCursorState(null)).toBe(false);
    expect(isCursorState('cursor')).toBe(false);
    expect(isExchangeCursor(null)).toBe(false);
    expect(isExchangeCursor(42)).toBe(false);
  });
});

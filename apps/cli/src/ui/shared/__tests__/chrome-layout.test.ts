import { describe, expect, it } from 'vitest';

import { arrayLines, calculateChromeLines, calculateVisibleRows, conditionalLines } from '../chrome-layout.js';

describe('chrome-layout utilities', () => {
  it('sums chrome line sections', () => {
    expect(calculateChromeLines({ header: 2, spacer: 1, detail: 4 })).toBe(7);
  });

  it('supports conditional and array-based line helpers', () => {
    expect(conditionalLines(true, 3)).toBe(3);
    expect(conditionalLines(false, 3)).toBe(0);
    expect(arrayLines(['a', 'b', 'c'])).toBe(3);
    expect(arrayLines(['a', 'b'], 2)).toBe(4);
    expect(arrayLines(undefined)).toBe(0);
  });

  it('never returns less than one visible row', () => {
    expect(calculateVisibleRows(24, 10)).toBe(14);
    expect(calculateVisibleRows(5, 10)).toBe(1);
  });
});

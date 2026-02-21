import { describe, expect, it } from 'vitest';

import { formatUtcDateDdMmYyyy, formatUtcDateYyyyMmDd } from '../date-format-utils.js';

describe('formatUtcDateYyyyMmDd', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    const date = new Date('2024-03-05T14:30:00Z');

    expect(formatUtcDateYyyyMmDd(date)).toBe('2024-03-05');
  });
});

describe('formatUtcDateDdMmYyyy', () => {
  it('formats a UTC date as DD-MM-YYYY', () => {
    const date = new Date('2024-03-05T14:30:00Z');

    expect(formatUtcDateDdMmYyyy(date)).toBe('05-03-2024');
  });
});

import { describe, expect, it } from 'vitest';

import { formatDuration, formatWaitTime } from '../format-duration.js';

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(123)).toBe('123ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(12345)).toBe('12.3s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(61000)).toBe('1m 1s');
    expect(formatDuration(125000)).toBe('2m 5s');
    expect(formatDuration(135789)).toBe('2m 15s');
  });
});

describe('formatWaitTime', () => {
  it('formats milliseconds', () => {
    expect(formatWaitTime(0)).toBe('0ms');
    expect(formatWaitTime(500)).toBe('500ms');
    expect(formatWaitTime(999)).toBe('999ms');
  });

  it('formats seconds', () => {
    expect(formatWaitTime(1000)).toBe('1.0s');
    expect(formatWaitTime(2500)).toBe('2.5s');
    expect(formatWaitTime(5000)).toBe('5.0s');
  });
});

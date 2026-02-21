import { describe, expect, it } from 'vitest';

import { BusinessDayFallbackExhaustedError, fetchWithBusinessDayFallback } from '../fx-fallback-utils.js';

describe('fetchWithBusinessDayFallback', () => {
  it('returns success on the first attempt', async () => {
    const requestedDate = new Date('2024-01-15T00:00:00Z');

    const result = await fetchWithBusinessDayFallback(requestedDate, {
      fetchForDate: () => Promise.resolve({ outcome: 'success', value: 'ok' }),
      maxAttempts: 7,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.value).toBe('ok');
      expect(result.value.daysBack).toBe(0);
      expect(result.value.actualDate.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    }
  });

  it('walks back dates until success', async () => {
    const requestedDate = new Date('2024-01-15T00:00:00Z');
    const attemptedDates: string[] = [];

    const result = await fetchWithBusinessDayFallback(requestedDate, {
      fetchForDate: ({ candidateDate, attemptIndex }) => {
        attemptedDates.push(candidateDate.toISOString());
        if (attemptIndex < 2) {
          return Promise.resolve({ error: new Error('no data'), outcome: 'retry' } as const);
        }
        return Promise.resolve({ outcome: 'success', value: 'value-from-fallback' } as const);
      },
      maxAttempts: 7,
    });

    expect(result.isOk()).toBe(true);
    expect(attemptedDates).toEqual([
      '2024-01-15T00:00:00.000Z',
      '2024-01-14T00:00:00.000Z',
      '2024-01-13T00:00:00.000Z',
    ]);
    if (result.isOk()) {
      expect(result.value.daysBack).toBe(2);
      expect(result.value.actualDate.toISOString()).toBe('2024-01-13T00:00:00.000Z');
      expect(result.value.value).toBe('value-from-fallback');
    }
  });

  it('fails immediately when fetch marks attempt as fail', async () => {
    const requestedDate = new Date('2024-01-15T00:00:00Z');
    const expectedError = new Error('invalid request');

    const result = await fetchWithBusinessDayFallback(requestedDate, {
      fetchForDate: () => Promise.resolve({ error: expectedError, outcome: 'fail' }),
      maxAttempts: 7,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe(expectedError);
    }
  });

  it('returns exhausted error with metadata when all retries fail', async () => {
    const requestedDate = new Date('2024-01-15T00:00:00Z');

    const result = await fetchWithBusinessDayFallback(requestedDate, {
      fetchForDate: () => Promise.resolve({ error: new Error('still no data'), outcome: 'retry' }),
      maxAttempts: 3,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(BusinessDayFallbackExhaustedError);
      if (result.error instanceof BusinessDayFallbackExhaustedError) {
        expect(result.error.maxAttempts).toBe(3);
        expect(result.error.requestedDate.toISOString()).toBe('2024-01-15T00:00:00.000Z');
        expect(result.error.lastAttemptDate.toISOString()).toBe('2024-01-13T00:00:00.000Z');
        expect(result.error.lastError?.message).toContain('still no data');
      }
    }
  });

  it('returns error for invalid maxAttempts', async () => {
    const result = await fetchWithBusinessDayFallback(new Date('2024-01-15T00:00:00Z'), {
      fetchForDate: () => Promise.resolve({ error: new Error('unused'), outcome: 'retry' }),
      maxAttempts: 0,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('maxAttempts must be at least 1');
    }
  });

  it('does not mutate the original requested date', async () => {
    const requestedDate = new Date('2024-01-15T00:00:00Z');
    const originalIso = requestedDate.toISOString();

    await fetchWithBusinessDayFallback(requestedDate, {
      fetchForDate: () => Promise.resolve({ error: new Error('no data'), outcome: 'retry' }),
      maxAttempts: 2,
    });

    expect(requestedDate.toISOString()).toBe(originalIso);
  });
});

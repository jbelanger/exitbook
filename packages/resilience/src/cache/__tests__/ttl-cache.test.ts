import { afterEach, describe, expect, it, vi } from 'vitest';

import { TtlCache } from '../ttl-cache.js';

describe('TtlCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for missing key', () => {
    const cache = new TtlCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves value', () => {
    const cache = new TtlCache();
    cache.set('key', 'value');
    expect(cache.get<string>('key')).toBe('value');
    cache.clear();
  });

  it('evicts expired entry on read', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const cache = new TtlCache(10);
    try {
      cache.set('key', 'value');

      vi.setSystemTime(new Date('2024-01-01T00:00:00.011Z'));
      expect(cache.get<string>('key')).toBeUndefined();
    } finally {
      cache.clear();
    }
  });

  it('cleanup removes expired entries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const cache = new TtlCache(10);
    try {
      cache.set('a', 1);
      cache.set('b', 2);

      vi.setSystemTime(new Date('2024-01-01T00:00:00.011Z'));
      cache.cleanup();

      expect(cache.get<number>('a')).toBeUndefined();
      expect(cache.get<number>('b')).toBeUndefined();
    } finally {
      cache.clear();
    }
  });

  it('clear removes all entries and stops auto-cleanup', () => {
    const cache = new TtlCache();
    cache.set('key', 'value');
    cache.startAutoCleanup();
    cache.clear();

    expect(cache.get<string>('key')).toBeUndefined();
  });

  it('startAutoCleanup is idempotent', () => {
    const cache = new TtlCache(100);
    try {
      cache.startAutoCleanup();
      cache.startAutoCleanup(); // should not create second timer
    } finally {
      cache.clear();
    }
  });
});

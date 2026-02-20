import { describe, expect, test, vi } from 'vitest';

import { ProviderResponseCache } from '../provider-response-cache.js';

describe('ProviderResponseCache', () => {
  test('evicts expired entry on read', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const cache = new ProviderResponseCache(10);

    try {
      cache.set('key', 'value');

      vi.setSystemTime(new Date('2024-01-01T00:00:00.011Z'));
      expect(cache.get<string>('key')).toBeUndefined();

      const internal = cache as unknown as { cache: Map<string, unknown> };
      expect(internal.cache.size).toBe(0);
    } finally {
      cache.clear();
      vi.useRealTimers();
    }
  });
});

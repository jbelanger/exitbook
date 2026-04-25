import { EventBus } from '@exitbook/events';
import { ok, type Result } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import type { ProviderError } from '../../contracts/errors.js';
import type { FailoverExecutionResult } from '../../contracts/index.js';
import type { ProviderEvent } from '../../events.js';
import { TokenMetadataCache } from '../cache.js';
import type { TokenMetadata, TokenMetadataRecord } from '../contracts.js';

function createTokenMetadataRecord(overrides: Partial<TokenMetadataRecord> = {}): TokenMetadataRecord {
  return {
    blockchain: 'ethereum',
    contractAddress: '0xabc',
    refreshedAt: new Date(),
    source: 'mock',
    symbol: 'ABC',
    ...overrides,
  };
}

function createQueries(metadataByContract: Map<string, TokenMetadataRecord | undefined>) {
  return {
    getByContracts: vi.fn().mockResolvedValue(ok(metadataByContract)),
    save: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TokenMetadataCache', () => {
  it('returns cache misses without provider fetch when provider fetch is disabled', async () => {
    const queries = createQueries(new Map([['0xabc', undefined]]));
    const fetchFn = vi.fn();
    const cache = new TokenMetadataCache(queries as never, fetchFn as never);

    const result = await cache.getBatch('ethereum', ['0xabc'], {
      allowProviderFetch: false,
      refreshStale: false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.get('0xabc')).toBeUndefined();
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not schedule stale refreshes when stale refresh is disabled', async () => {
    const staleMetadata = createTokenMetadataRecord({
      refreshedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const queries = createQueries(new Map([['0xabc', staleMetadata]]));
    const fetchFn = vi.fn();
    const cache = new TokenMetadataCache(queries as never, fetchFn as never);

    const result = await cache.getBatch('ethereum', ['0xabc'], {
      allowProviderFetch: false,
      refreshStale: false,
    });

    expect(result.isOk()).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not schedule stale refreshes when provider fetch is disabled', async () => {
    const staleMetadata = createTokenMetadataRecord({
      refreshedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const queries = createQueries(new Map([['0xabc', staleMetadata]]));
    const fetchFn = vi.fn();
    const cache = new TokenMetadataCache(queries as never, fetchFn as never);

    const result = await cache.getBatch('ethereum', ['0xabc'], {
      allowProviderFetch: false,
    });

    expect(result.isOk()).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('emits zero provider fetches for cache-only misses', async () => {
    const queries = createQueries(new Map([['0xabc', undefined]]));
    const fetchFn = vi.fn();
    const events: ProviderEvent[] = [];
    const eventBus = new EventBus<ProviderEvent>({ onError: vi.fn() });
    eventBus.subscribe((event) => events.push(event));
    const cache = new TokenMetadataCache(queries as never, fetchFn as never, eventBus);

    const result = await cache.getBatch('ethereum', ['0xabc'], {
      allowProviderFetch: false,
    });
    await flushMicrotasks();

    expect(result.isOk()).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        cacheMisses: 1,
        providerFetches: 0,
        type: 'provider.metadata.batch.completed',
      })
    );
  });

  it('deduplicates in-flight stale refreshes for repeated batch lookups', async () => {
    const staleMetadata = createTokenMetadataRecord({
      refreshedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const queries = createQueries(new Map([['0xabc', staleMetadata]]));

    let resolveFetch: ((value: Result<FailoverExecutionResult<TokenMetadata[]>, ProviderError>) => void) | undefined;
    const fetchPromise = new Promise<Result<FailoverExecutionResult<TokenMetadata[]>, ProviderError>>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchFn = vi.fn().mockReturnValue(fetchPromise);
    const cache = new TokenMetadataCache(queries as never, fetchFn);

    await cache.getBatch('ethereum', ['0xabc']);
    await cache.getBatch('ethereum', ['0xabc']);

    expect(fetchFn).toHaveBeenCalledTimes(1);

    resolveFetch?.(
      ok({
        data: [{ contractAddress: '0xabc', symbol: 'ABC' }],
        providerName: 'mock',
      })
    );
    await flushMicrotasks();
  });
});

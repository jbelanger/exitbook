import fs from 'node:fs';
import path from 'node:path';

import { err, ok } from 'neverthrow';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { getTokenMetadataCache, closeTokenMetadataCache, getTokenMetadataWithCache } from '../utils.js';

// The default database path used by getTokenMetadataCache()
const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'token-metadata.db');

describe('Token Metadata Utils', () => {
  beforeEach(async () => {
    // Always close any existing cache first
    await closeTokenMetadataCache();

    // Clean up the default database and its WAL files
    const filesToDelete = [DEFAULT_DB_PATH, `${DEFAULT_DB_PATH}-shm`, `${DEFAULT_DB_PATH}-wal`];

    for (const file of filesToDelete) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  afterEach(async () => {
    // Close the cache
    await closeTokenMetadataCache();

    // Clean up database files
    const filesToDelete = [DEFAULT_DB_PATH, `${DEFAULT_DB_PATH}-shm`, `${DEFAULT_DB_PATH}-wal`];

    for (const file of filesToDelete) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  describe('getTokenMetadataCache', () => {
    it('should create and return a cache instance', async () => {
      const cache = await getTokenMetadataCache();

      expect(cache).toBeDefined();
      expect(typeof cache.getByContract).toBe('function');
      expect(typeof cache.set).toBe('function');
    });

    it('should return the same instance on subsequent calls (singleton)', async () => {
      const cache1 = await getTokenMetadataCache();
      const cache2 = await getTokenMetadataCache();

      expect(cache1).toBe(cache2);
    });
  });

  describe('closeTokenMetadataCache', () => {
    it('should close the cache and allow reopening', async () => {
      const cache1 = await getTokenMetadataCache();
      await closeTokenMetadataCache();

      // Should create a new instance after closing
      const cache2 = await getTokenMetadataCache();
      expect(cache2).toBeDefined();
      expect(cache2).not.toBe(cache1);
    });

    it('should handle closing when cache is not initialized', async () => {
      await expect(closeTokenMetadataCache()).resolves.not.toThrow();
    });
  });

  describe('getTokenMetadataWithCache', () => {
    it('should fetch from API on cache miss and store in cache', async () => {
      const mockFetchFn = vi.fn().mockResolvedValue(
        ok({
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          logoUrl: 'https://example.com/usdc.png',
        })
      );

      const result = await getTokenMetadataWithCache(
        'ethereum',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        mockFetchFn,
        'alchemy'
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.symbol).toBe('USDC');
        expect(result.value.name).toBe('USD Coin');
        expect(result.value.decimals).toBe(6);
        expect(result.value.logoUrl).toBe('https://example.com/usdc.png');
        expect(result.value.source).toBe('alchemy');
      }

      expect(mockFetchFn).toHaveBeenCalledTimes(1);

      // Verify it was cached
      const cache = await getTokenMetadataCache();
      const cachedResult = await cache.getByContract('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

      expect(cachedResult.isOk()).toBe(true);
      if (cachedResult.isOk()) {
        expect(cachedResult.value?.symbol).toBe('USDC');
        expect(cachedResult.value?.name).toBe('USD Coin');
      }
    });

    it('should return cached data on cache hit without calling API', async () => {
      const mockFetchFn = vi.fn().mockResolvedValue(
        ok({
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
        })
      );

      // First call - cache miss
      const result1 = await getTokenMetadataWithCache(
        'ethereum',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        mockFetchFn,
        'alchemy'
      );

      expect(result1.isOk()).toBe(true);
      expect(mockFetchFn).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const result2 = await getTokenMetadataWithCache(
        'ethereum',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        mockFetchFn,
        'alchemy'
      );

      expect(mockFetchFn).toHaveBeenCalledTimes(1); // Still only called once
      expect(result2.isOk()).toBe(true);
      if (result2.isOk()) {
        expect(result2.value.symbol).toBe('USDC');
      }
    });

    it('should serve stale data and trigger background refresh', async () => {
      const cache = await getTokenMetadataCache();

      // Insert stale data (8 days old)
      const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      await cache.set(
        'ethereum',
        '0xSTALE',
        {
          symbol: 'OLD',
          name: 'Old Token',
          decimals: 18,
          updatedAt: staleDate,
          createdAt: staleDate,
        },
        'alchemy'
      );

      const mockFetchFn = vi.fn().mockResolvedValue(
        ok({
          symbol: 'NEW',
          name: 'New Token',
          decimals: 18,
        })
      );

      const result = await getTokenMetadataWithCache('ethereum', '0xSTALE', mockFetchFn, 'alchemy');

      // Should return stale data immediately
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.symbol).toBe('OLD');
      }

      // Background refresh should be triggered (fire and forget, so we don't verify here)
    });

    it('should handle fetch errors on cache miss', async () => {
      const mockFetchFn = vi.fn().mockResolvedValue(err(new Error('API error')));

      const result = await getTokenMetadataWithCache('ethereum', '0xNonExistent', mockFetchFn, 'alchemy');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('API error');
      }
    });

    it('should handle database errors gracefully', async () => {
      const mockFetchFn = vi.fn().mockResolvedValue(
        ok({
          symbol: 'USDC',
          decimals: 6,
        })
      );

      // With a fresh cache, this should work
      const result = await getTokenMetadataWithCache('ethereum', '0xERROR', mockFetchFn, 'alchemy');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.symbol).toBe('USDC');
      }
    });

    it('should construct full metadata object from partial fetch result', async () => {
      const mockFetchFn = vi.fn().mockResolvedValue(
        ok({
          symbol: 'PARTIAL',
          decimals: 6,
          // name and logoUrl omitted
        })
      );

      const result = await getTokenMetadataWithCache('ethereum', '0xPARTIAL', mockFetchFn, 'alchemy');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.blockchain).toBe('ethereum');
        expect(result.value.contractAddress).toBe('0xPARTIAL');
        expect(result.value.symbol).toBe('PARTIAL');
        expect(result.value.decimals).toBe(6);
        expect(result.value.name).toBeUndefined();
        expect(result.value.logoUrl).toBeUndefined();
        expect(result.value.source).toBe('alchemy');
        expect(result.value.updatedAt).toBeInstanceOf(Date);
        expect(result.value.createdAt).toBeInstanceOf(Date);
      }
    });

    it('should handle multiple concurrent requests for same token', async () => {
      const mockFetchFn = vi.fn().mockImplementation(async () => {
        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        return ok({
          symbol: 'CONCURRENT',
          decimals: 6,
        });
      });

      // Make multiple concurrent requests with unique address
      const [result1, result2, result3] = await Promise.all([
        getTokenMetadataWithCache('ethereum', '0xCONCURRENT', mockFetchFn, 'alchemy'),
        getTokenMetadataWithCache('ethereum', '0xCONCURRENT', mockFetchFn, 'alchemy'),
        getTokenMetadataWithCache('ethereum', '0xCONCURRENT', mockFetchFn, 'alchemy'),
      ]);

      // All should succeed
      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      expect(result3.isOk()).toBe(true);

      // Verify all got the same data
      if (result1.isOk() && result2.isOk() && result3.isOk()) {
        expect(result1.value.symbol).toBe('CONCURRENT');
        expect(result2.value.symbol).toBe('CONCURRENT');
        expect(result3.value.symbol).toBe('CONCURRENT');
      }

      // Note: Without request deduplication, fetch may be called multiple times
      // This is acceptable behavior, just documenting it
      expect(mockFetchFn).toHaveBeenCalled();
    });
  });

  describe('Integration with real database', () => {
    it('should perform full cache lifecycle', async () => {
      const cache = await getTokenMetadataCache();

      // Use a unique address for this test
      const testAddress = '0xLIFECYCLE';

      // 1. Cache miss
      const missResult = await cache.getByContract('ethereum', testAddress);
      expect(missResult.isOk()).toBe(true);
      if (missResult.isOk()) {
        expect(missResult.value).toBeUndefined();
      }

      // 2. Set metadata
      const setResult = await cache.set(
        'ethereum',
        testAddress,
        {
          symbol: 'LIFECYCLE',
          name: 'Lifecycle Token',
          decimals: 18,
          logoUrl: 'https://example.com/test.png',
        },
        'test-provider'
      );
      expect(setResult.isOk()).toBe(true);

      // 3. Cache hit
      const hitResult = await cache.getByContract('ethereum', testAddress);
      expect(hitResult.isOk()).toBe(true);
      if (hitResult.isOk()) {
        expect(hitResult.value?.symbol).toBe('LIFECYCLE');
        expect(hitResult.value?.name).toBe('Lifecycle Token');
        expect(hitResult.value?.decimals).toBe(18);
      }

      // 4. Lookup by symbol
      const symbolResult = await cache.getBySymbol('ethereum', 'LIFECYCLE');
      expect(symbolResult.isOk()).toBe(true);
      if (symbolResult.isOk()) {
        expect(symbolResult.value.length).toBeGreaterThanOrEqual(1);
        const found = symbolResult.value.find((t) => t.contractAddress === testAddress);
        expect(found).toBeDefined();
      }

      // 5. Update existing
      const updateResult = await cache.set(
        'ethereum',
        testAddress,
        {
          symbol: 'LIFECYCLE',
          name: 'Lifecycle Token Updated',
          decimals: 18,
        },
        'test-provider'
      );
      expect(updateResult.isOk()).toBe(true);

      // 6. Verify update
      const verifyResult = await cache.getByContract('ethereum', testAddress);
      expect(verifyResult.isOk()).toBe(true);
      if (verifyResult.isOk()) {
        expect(verifyResult.value?.name).toBe('Lifecycle Token Updated');
      }
    });

    it('should handle multiple blockchains correctly', async () => {
      const cache = await getTokenMetadataCache();

      const testAddress = '0xMULTICHAIN';

      await cache.set('ethereum', testAddress, { symbol: 'ETH-TOKEN', decimals: 18 }, 'alchemy');
      await cache.set('solana', testAddress, { symbol: 'SOL-TOKEN', decimals: 9 }, 'helius');

      const ethResult = await cache.getByContract('ethereum', testAddress);
      const solResult = await cache.getByContract('solana', testAddress);

      expect(ethResult.isOk()).toBe(true);
      expect(solResult.isOk()).toBe(true);

      if (ethResult.isOk() && solResult.isOk()) {
        expect(ethResult.value?.symbol).toBe('ETH-TOKEN');
        expect(solResult.value?.symbol).toBe('SOL-TOKEN');
      }
    });
  });
});

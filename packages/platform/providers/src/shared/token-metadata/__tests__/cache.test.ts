/* eslint-disable unicorn/no-null -- needed for db */

import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenMetadataCache } from '../cache.js';
import type { TokenMetadataDatabase } from '../database-schema.js';
import type { TokenMetadata } from '../schemas.js';

// Mock Kysely database
const createMockDb = () => {
  const mockSelectFrom = vi.fn();
  const mockInsertInto = vi.fn();
  const mockValues = vi.fn();
  const mockOnConflict = vi.fn();
  const mockExecute = vi.fn();
  const mockExecuteTakeFirst = vi.fn();
  const mockSelectAll = vi.fn();
  const mockSelect = vi.fn();
  const mockWhere = vi.fn();
  const mockDoUpdateSet = vi.fn();
  const mockColumns = vi.fn();

  const queryBuilder = {
    selectFrom: mockSelectFrom,
    selectAll: mockSelectAll,
    select: mockSelect,
    where: mockWhere,
    execute: mockExecute,
    executeTakeFirst: mockExecuteTakeFirst,
    insertInto: mockInsertInto,
    values: mockValues,
    onConflict: mockOnConflict,
  };

  // Chain methods
  mockSelectFrom.mockReturnValue(queryBuilder);
  mockSelectAll.mockReturnValue(queryBuilder);
  mockSelect.mockReturnValue(queryBuilder);
  mockWhere.mockReturnValue(queryBuilder);
  mockInsertInto.mockReturnValue(queryBuilder);
  mockValues.mockReturnValue(queryBuilder);
  mockOnConflict.mockReturnValue(queryBuilder);
  mockColumns.mockReturnValue({ doUpdateSet: mockDoUpdateSet });
  mockDoUpdateSet.mockReturnValue(queryBuilder);

  return {
    db: queryBuilder as unknown as Kysely<TokenMetadataDatabase>,
    mocks: {
      selectFrom: mockSelectFrom,
      insertInto: mockInsertInto,
      values: mockValues,
      onConflict: mockOnConflict,
      execute: mockExecute,
      executeTakeFirst: mockExecuteTakeFirst,
      selectAll: mockSelectAll,
      select: mockSelect,
      where: mockWhere,
      doUpdateSet: mockDoUpdateSet,
      columns: mockColumns,
    },
  };
};

describe('TokenMetadataCache', () => {
  let cache: TokenMetadataCache;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    cache = new TokenMetadataCache(mockDb.db);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getByContract', () => {
    it('should return token metadata on cache hit', async () => {
      const mockResult = {
        id: 1,
        blockchain: 'ethereum',
        contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        logo_url: 'https://example.com/usdc.png',
        source: 'alchemy',
        updated_at: new Date('2025-01-01').toISOString(),
        created_at: new Date('2025-01-01').toISOString(),
      };

      mockDb.mocks.executeTakeFirst.mockResolvedValue(mockResult);

      const result = await cache.getByContract('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeDefined();
        expect(result.value?.symbol).toBe('USDC');
        expect(result.value?.name).toBe('USD Coin');
        expect(result.value?.decimals).toBe(6);
        expect(result.value?.contractAddress).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      }

      expect(mockDb.mocks.selectFrom).toHaveBeenCalledWith('token_metadata');
      expect(mockDb.mocks.where).toHaveBeenCalledWith('blockchain', '=', 'ethereum');
      expect(mockDb.mocks.where).toHaveBeenCalledWith(
        'contract_address',
        '=',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      );
    });

    it('should return undefined on cache miss', async () => {
      mockDb.mocks.executeTakeFirst.mockResolvedValue(undefined as unknown);

      const result = await cache.getByContract('ethereum', '0xNonExistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should handle null fields gracefully', async () => {
      const mockResult = {
        id: 1,
        blockchain: 'solana',
        contract_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: null,
        name: null,
        decimals: null,
        logo_url: null,
        source: 'helius',
        updated_at: new Date('2025-01-01').toISOString(),
        created_at: new Date('2025-01-01').toISOString(),
      };

      mockDb.mocks.executeTakeFirst.mockResolvedValue(mockResult);

      const result = await cache.getByContract('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.symbol).toBeUndefined();
        expect(result.value?.name).toBeUndefined();
        expect(result.value?.decimals).toBeUndefined();
        expect(result.value?.logoUrl).toBeUndefined();
      }
    });

    it('should return error on database failure', async () => {
      mockDb.mocks.executeTakeFirst.mockRejectedValue(new Error('Database error'));

      const result = await cache.getByContract('ethereum', '0xABC');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database error');
      }
    });
  });

  describe('getBySymbol', () => {
    it('should return token metadata for symbol', async () => {
      const mockContracts = [{ contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }];
      const mockMetadata = {
        id: 1,
        blockchain: 'ethereum',
        contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        logo_url: null,
        source: 'alchemy',
        updated_at: new Date('2025-01-01').toISOString(),
        created_at: new Date('2025-01-01').toISOString(),
      };

      mockDb.mocks.execute.mockResolvedValue(mockContracts);
      mockDb.mocks.executeTakeFirst.mockResolvedValue(mockMetadata);

      const result = await cache.getBySymbol('ethereum', 'USDC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.symbol).toBe('USDC');
      }

      expect(mockDb.mocks.selectFrom).toHaveBeenCalledWith('symbol_index');
      expect(mockDb.mocks.where).toHaveBeenCalledWith('blockchain', '=', 'ethereum');
      expect(mockDb.mocks.where).toHaveBeenCalledWith('symbol', '=', 'USDC');
    });

    it('should return multiple contracts for colliding symbols', async () => {
      const mockContracts = [{ contract_address: '0xAAA' }, { contract_address: '0xBBB' }];
      const mockMetadata1 = {
        id: 1,
        blockchain: 'ethereum',
        contract_address: '0xAAA',
        symbol: 'UNI',
        name: 'Uniswap 1',
        decimals: 18,
        logo_url: null,
        source: 'alchemy',
        updated_at: new Date('2025-01-01').toISOString(),
        created_at: new Date('2025-01-01').toISOString(),
      };
      const mockMetadata2 = {
        id: 2,
        blockchain: 'ethereum',
        contract_address: '0xBBB',
        symbol: 'UNI',
        name: 'Uniswap 2',
        decimals: 18,
        logo_url: null,
        source: 'moralis',
        updated_at: new Date('2025-01-01').toISOString(),
        created_at: new Date('2025-01-01').toISOString(),
      };

      mockDb.mocks.execute.mockResolvedValue(mockContracts);
      mockDb.mocks.executeTakeFirst.mockResolvedValueOnce(mockMetadata1).mockResolvedValueOnce(mockMetadata2);

      const result = await cache.getBySymbol('ethereum', 'UNI');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.name).toBe('Uniswap 1');
        expect(result.value[1]?.name).toBe('Uniswap 2');
      }
    });

    it('should return empty array on cache miss', async () => {
      mockDb.mocks.execute.mockResolvedValue([]);

      const result = await cache.getBySymbol('ethereum', 'NONEXISTENT');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('should return error on database failure', async () => {
      mockDb.mocks.execute.mockRejectedValue(new Error('Database error'));

      const result = await cache.getBySymbol('ethereum', 'USDC');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database error');
      }
    });
  });

  describe('set', () => {
    it('should insert new token metadata', async () => {
      mockDb.mocks.execute.mockResolvedValue(undefined as unknown);
      mockDb.mocks.executeTakeFirst.mockResolvedValue(undefined as unknown);

      const metadata: Partial<TokenMetadata> = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        logoUrl: 'https://example.com/usdc.png',
      };

      const result = await cache.set('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', metadata, 'alchemy');

      expect(result.isOk()).toBe(true);
      expect(mockDb.mocks.insertInto).toHaveBeenCalledWith('token_metadata');
      expect(mockDb.mocks.values).toHaveBeenCalledWith(
        expect.objectContaining({
          blockchain: 'ethereum',
          contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          logo_url: 'https://example.com/usdc.png',
          source: 'alchemy',
        })
      );
    });

    it('should update existing token metadata on conflict', async () => {
      mockDb.mocks.execute.mockResolvedValue(undefined as unknown);
      mockDb.mocks.executeTakeFirst.mockResolvedValue(undefined as unknown);

      const metadata: Partial<TokenMetadata> = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
      };

      const result = await cache.set('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', metadata, 'alchemy');

      expect(result.isOk()).toBe(true);
      expect(mockDb.mocks.onConflict).toHaveBeenCalled();
    });

    it('should update symbol index when symbol provided', async () => {
      mockDb.mocks.execute.mockResolvedValue(undefined as unknown);
      mockDb.mocks.executeTakeFirst.mockResolvedValue(undefined as unknown);

      const metadata: Partial<TokenMetadata> = {
        symbol: 'USDC',
        decimals: 6,
      };

      await cache.set('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', metadata, 'alchemy');

      // Verify symbol_index was queried
      expect(mockDb.mocks.selectFrom).toHaveBeenCalledWith('symbol_index');
    });

    it('should handle null values correctly', async () => {
      mockDb.mocks.execute.mockResolvedValue(undefined as unknown);
      mockDb.mocks.executeTakeFirst.mockResolvedValue(undefined as unknown);

      const metadata: Partial<TokenMetadata> = {
        decimals: 6,
      };

      const result = await cache.set('ethereum', '0xABC', metadata, 'alchemy');

      expect(result.isOk()).toBe(true);
      expect(mockDb.mocks.values).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: null,
          name: null,
          logo_url: null,
        })
      );
    });

    it('should return error on database failure', async () => {
      mockDb.mocks.execute.mockRejectedValue(new Error('Database error'));

      const result = await cache.set('ethereum', '0xABC', { symbol: 'TEST' }, 'alchemy');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database error');
      }
    });
  });

  describe('isStale', () => {
    it('should return false for fresh data (within 7 days)', () => {
      const now = new Date();
      const freshDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000); // 6 days ago

      expect(cache.isStale(freshDate)).toBe(false);
    });

    it('should return true for stale data (older than 7 days)', () => {
      const now = new Date();
      const staleDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

      expect(cache.isStale(staleDate)).toBe(true);
    });

    it('should return false for data exactly 7 days old', () => {
      const now = new Date();
      const exactDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      expect(cache.isStale(exactDate)).toBe(false);
    });

    it('should handle very old data', () => {
      const veryOldDate = new Date('2020-01-01');

      expect(cache.isStale(veryOldDate)).toBe(true);
    });
  });

  describe('refreshInBackground', () => {
    it('should call fetch function in background', async () => {
      const mockFetchFn = vi.fn().mockResolvedValue(
        ok({
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
        })
      );

      mockDb.mocks.execute.mockResolvedValue(undefined as unknown);
      mockDb.mocks.executeTakeFirst.mockResolvedValue(undefined as unknown);

      cache.refreshInBackground('ethereum', '0xABC', mockFetchFn, 'alchemy');

      // Wait for background operation to start
      await new Promise((resolve) => setImmediate(resolve));

      // The function should be called (eventually)
      expect(mockFetchFn).toHaveBeenCalled();
    });

    it('should not throw on fetch errors', () => {
      const mockFetchFn = vi.fn().mockResolvedValue(err(new Error('Fetch failed')));

      // Should not throw
      expect(() => {
        cache.refreshInBackground('ethereum', '0xABC', mockFetchFn, 'alchemy');
      }).not.toThrow();
    });

    it('should not throw on cache update errors', () => {
      const mockFetchFn = vi.fn().mockResolvedValue(
        ok({
          symbol: 'USDC',
          decimals: 6,
        })
      );

      mockDb.mocks.execute.mockRejectedValue(new Error('Database error'));

      // Should not throw
      expect(() => {
        cache.refreshInBackground('ethereum', '0xABC', mockFetchFn, 'alchemy');
      }).not.toThrow();
    });
  });
});

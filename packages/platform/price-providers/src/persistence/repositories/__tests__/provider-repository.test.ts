import { Currency } from '@exitbook/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPricesDatabase, initializePricesDatabase, type PricesDB } from '../../database.js';
import type { CoinMappingInput } from '../provider-repository.js';
import { ProviderRepository } from '../provider-repository.js';

describe('ProviderRepository', () => {
  let db: PricesDB;
  let repository: ProviderRepository;

  beforeEach(async () => {
    // Create in-memory database
    const dbResult = createPricesDatabase(':memory:');
    if (dbResult.isErr()) {
      throw dbResult.error;
    }
    db = dbResult.value;

    // Run migrations
    const migrationResult = await initializePricesDatabase(db);
    if (migrationResult.isErr()) {
      throw migrationResult.error;
    }

    repository = new ProviderRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('upsertProvider', () => {
    it('should create new provider', async () => {
      const result = await repository.upsertProvider('coingecko', 'CoinGecko');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.name).toBe('coingecko');
        expect(result.value.display_name).toBe('CoinGecko');
        expect(result.value.is_active).toBeTruthy();
        expect(result.value.id).toBeGreaterThan(0);
      }
    });

    it('should return existing provider on duplicate call', async () => {
      const result1 = await repository.upsertProvider('coingecko', 'CoinGecko');
      expect(result1.isOk()).toBe(true);

      const result2 = await repository.upsertProvider('coingecko', 'CoinGecko');
      expect(result2.isOk()).toBe(true);

      if (result1.isOk() && result2.isOk()) {
        expect(result1.value.id).toBe(result2.value.id);
      }
    });

    it('should create multiple different providers', async () => {
      const result1 = await repository.upsertProvider('coingecko', 'CoinGecko');
      const result2 = await repository.upsertProvider('cryptocompare', 'CryptoCompare');

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);

      if (result1.isOk() && result2.isOk()) {
        expect(result1.value.id).not.toBe(result2.value.id);
      }
    });
  });

  describe('getProviderByName', () => {
    it('should return undefined when provider does not exist', async () => {
      const result = await repository.getProviderByName('nonexistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should return provider when it exists', async () => {
      await repository.upsertProvider('coingecko', 'CoinGecko');

      const result = await repository.getProviderByName('coingecko');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeDefined();
        expect(result.value?.name).toBe('coingecko');
        expect(result.value?.display_name).toBe('CoinGecko');
      }
    });
  });

  describe('updateProviderSync', () => {
    it('should update sync timestamp and coin count', async () => {
      const providerResult = await repository.upsertProvider('coingecko', 'CoinGecko');
      expect(providerResult.isOk()).toBe(true);
      if (!providerResult.isOk()) return;

      const providerId = providerResult.value.id;

      const updateResult = await repository.updateProviderSync(providerId, 5000);

      expect(updateResult.isOk()).toBe(true);

      const getResult = await repository.getProviderByName('coingecko');
      expect(getResult.isOk()).toBe(true);
      if (getResult.isOk()) {
        expect(getResult.value?.coin_list_count).toBe(5000);
        expect(getResult.value?.last_coin_list_sync).toBeDefined();
      }
    });
  });

  describe('upsertCoinMappings', () => {
    let providerId: number;

    beforeEach(async () => {
      const providerResult = await repository.upsertProvider('coingecko', 'CoinGecko');
      if (providerResult.isOk()) {
        providerId = providerResult.value.id;
      }
    });

    it('should insert new coin mappings', async () => {
      const mappings: CoinMappingInput[] = [
        { symbol: 'BTC', coin_id: 'bitcoin', coin_name: 'Bitcoin' },
        { symbol: 'ETH', coin_id: 'ethereum', coin_name: 'Ethereum' },
        { symbol: 'SOL', coin_id: 'solana', coin_name: 'Solana' },
      ];

      const result = await repository.upsertCoinMappings(providerId, mappings);

      expect(result.isOk()).toBe(true);

      const allMappings = await repository.getAllCoinMappings(providerId);
      expect(allMappings.isOk()).toBe(true);
      if (allMappings.isOk()) {
        expect(allMappings.value).toHaveLength(3);
      }
    });

    it('should replace existing mappings on upsert', async () => {
      const mappings1: CoinMappingInput[] = [
        { symbol: 'BTC', coin_id: 'bitcoin', coin_name: 'Bitcoin' },
        { symbol: 'ETH', coin_id: 'ethereum', coin_name: 'Ethereum' },
      ];

      await repository.upsertCoinMappings(providerId, mappings1);

      const mappings2: CoinMappingInput[] = [
        { symbol: 'BTC', coin_id: 'bitcoin-new', coin_name: 'Bitcoin Updated' },
        { symbol: 'SOL', coin_id: 'solana', coin_name: 'Solana' },
      ];

      await repository.upsertCoinMappings(providerId, mappings2);

      const allMappings = await repository.getAllCoinMappings(providerId);
      expect(allMappings.isOk()).toBe(true);
      if (allMappings.isOk()) {
        expect(allMappings.value).toHaveLength(2);
        // ETH should be gone, SOL should be added, BTC should be updated
        const btcMapping = allMappings.value.find((m) => m.symbol === 'BTC');
        expect(btcMapping?.coin_id).toBe('bitcoin-new');
        const solMapping = allMappings.value.find((m) => m.symbol === 'SOL');
        expect(solMapping).toBeDefined();
        const ethMapping = allMappings.value.find((m) => m.symbol === 'ETH');
        expect(ethMapping).toBeUndefined();
      }
    });

    it('should handle large batch of mappings (>500)', async () => {
      const mappings: CoinMappingInput[] = [];
      for (let i = 1; i <= 1000; i++) {
        mappings.push({
          symbol: `TOKEN${i}`,
          coin_id: `token-${i}`,
          coin_name: `Token ${i}`,
        });
      }

      const result = await repository.upsertCoinMappings(providerId, mappings);

      expect(result.isOk()).toBe(true);

      const allMappings = await repository.getAllCoinMappings(providerId);
      expect(allMappings.isOk()).toBe(true);
      if (allMappings.isOk()) {
        expect(allMappings.value).toHaveLength(1000);
      }
    });

    it('should normalize symbols to uppercase', async () => {
      const mappings: CoinMappingInput[] = [{ symbol: 'btc', coin_id: 'bitcoin', coin_name: 'Bitcoin' }];

      await repository.upsertCoinMappings(providerId, mappings);

      const result = await repository.getCoinIdForSymbol(providerId, Currency.create('BTC'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('bitcoin');
      }
    });

    it('should respect priority when provided', async () => {
      const mappings: CoinMappingInput[] = [
        { symbol: 'WBTC', coin_id: 'wrapped-bitcoin', coin_name: 'Wrapped Bitcoin', priority: 2 },
        { symbol: 'BTC', coin_id: 'bitcoin', coin_name: 'Bitcoin', priority: 1 },
      ];

      await repository.upsertCoinMappings(providerId, mappings);

      const allMappings = await repository.getAllCoinMappings(providerId);
      expect(allMappings.isOk()).toBe(true);
      if (allMappings.isOk()) {
        const btcMapping = allMappings.value.find((m) => m.symbol === 'BTC');
        expect(btcMapping?.priority).toBe(1);
      }
    });
  });

  describe('getCoinIdForSymbol', () => {
    let providerId: number;

    beforeEach(async () => {
      const providerResult = await repository.upsertProvider('coingecko', 'CoinGecko');
      if (providerResult.isOk()) {
        providerId = providerResult.value.id;
      }

      const mappings: CoinMappingInput[] = [
        { symbol: 'BTC', coin_id: 'bitcoin', coin_name: 'Bitcoin', priority: 1 },
        { symbol: 'ETH', coin_id: 'ethereum', coin_name: 'Ethereum', priority: 1 },
      ];

      await repository.upsertCoinMappings(providerId, mappings);
    });

    it('should return coin ID for existing symbol', async () => {
      const result = await repository.getCoinIdForSymbol(providerId, Currency.create('BTC'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('bitcoin');
      }
    });

    it('should return undefined for non-existent symbol', async () => {
      const result = await repository.getCoinIdForSymbol(providerId, Currency.create('XYZ'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should be case-insensitive', async () => {
      const result = await repository.getCoinIdForSymbol(providerId, Currency.create('btc'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('bitcoin');
      }
    });

    it('should respect priority ordering', async () => {
      // Add duplicate symbol with different priorities
      const mappings: CoinMappingInput[] = [
        { symbol: 'USDT', coin_id: 'tether-erc20', coin_name: 'Tether (ERC20)', priority: 2 },
        { symbol: 'USDT', coin_id: 'tether', coin_name: 'Tether', priority: 1 },
        { symbol: 'USDT', coin_id: 'tether-trc20', coin_name: 'Tether (TRC20)', priority: 3 },
      ];

      await repository.upsertCoinMappings(providerId, mappings);

      const result = await repository.getCoinIdForSymbol(providerId, Currency.create('USDT'));

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('tether'); // priority 1
      }
    });
  });

  describe('getAllCoinMappings', () => {
    let providerId: number;

    beforeEach(async () => {
      const providerResult = await repository.upsertProvider('coingecko', 'CoinGecko');
      if (providerResult.isOk()) {
        providerId = providerResult.value.id;
      }
    });

    it('should return empty array when no mappings exist', async () => {
      const result = await repository.getAllCoinMappings(providerId);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return all mappings for provider', async () => {
      const mappings: CoinMappingInput[] = [
        { symbol: 'BTC', coin_id: 'bitcoin', coin_name: 'Bitcoin' },
        { symbol: 'ETH', coin_id: 'ethereum', coin_name: 'Ethereum' },
        { symbol: 'SOL', coin_id: 'solana', coin_name: 'Solana' },
      ];

      await repository.upsertCoinMappings(providerId, mappings);

      const result = await repository.getAllCoinMappings(providerId);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(3);
        expect(result.value.some((m) => m.symbol === 'BTC')).toBe(true);
        expect(result.value.some((m) => m.symbol === 'ETH')).toBe(true);
        expect(result.value.some((m) => m.symbol === 'SOL')).toBe(true);
      }
    });

    it('should only return mappings for specific provider', async () => {
      const provider2Result = await repository.upsertProvider('cryptocompare', 'CryptoCompare');
      expect(provider2Result.isOk()).toBe(true);
      if (!provider2Result.isOk()) return;
      const provider2Id = provider2Result.value.id;

      await repository.upsertCoinMappings(providerId, [{ symbol: 'BTC', coin_id: 'bitcoin', coin_name: 'Bitcoin' }]);

      await repository.upsertCoinMappings(provider2Id, [{ symbol: 'ETH', coin_id: 'ethereum', coin_name: 'Ethereum' }]);

      const result1 = await repository.getAllCoinMappings(providerId);
      expect(result1.isOk()).toBe(true);
      if (result1.isOk()) {
        expect(result1.value).toHaveLength(1);
        expect(result1.value[0]?.symbol).toBe('BTC');
      }

      const result2 = await repository.getAllCoinMappings(provider2Id);
      expect(result2.isOk()).toBe(true);
      if (result2.isOk()) {
        expect(result2.value).toHaveLength(1);
        expect(result2.value[0]?.symbol).toBe('ETH');
      }
    });
  });

  describe('needsCoinListSync', () => {
    it('should return error when provider does not exist', async () => {
      const result = await repository.needsCoinListSync(999);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not found');
      }
    });

    it('should return true when never synced', async () => {
      const providerResult = await repository.upsertProvider('coingecko', 'CoinGecko');
      expect(providerResult.isOk()).toBe(true);
      if (!providerResult.isOk()) return;

      const result = await repository.needsCoinListSync(providerResult.value.id);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('should return true when coin count is zero', async () => {
      const providerResult = await repository.upsertProvider('coingecko', 'CoinGecko');
      expect(providerResult.isOk()).toBe(true);
      if (!providerResult.isOk()) return;

      // Update with zero coin count
      await repository.updateProviderSync(providerResult.value.id, 0);

      const result = await repository.needsCoinListSync(providerResult.value.id);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false when recently synced', async () => {
      const providerResult = await repository.upsertProvider('coingecko', 'CoinGecko');
      expect(providerResult.isOk()).toBe(true);
      if (!providerResult.isOk()) return;

      await repository.updateProviderSync(providerResult.value.id, 5000);

      const result = await repository.needsCoinListSync(providerResult.value.id);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });

    it('should return true when sync is stale (>7 days)', async () => {
      const providerResult = await repository.upsertProvider('coingecko', 'CoinGecko');
      expect(providerResult.isOk()).toBe(true);
      if (!providerResult.isOk()) return;

      const providerId = providerResult.value.id;

      // Manually set last sync to 8 days ago
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      await db
        .updateTable('providers')
        .set({
          last_coin_list_sync: eightDaysAgo.toISOString(),
          coin_list_count: 5000,
        })
        .where('id', '=', providerId)
        .execute();

      const result = await repository.needsCoinListSync(providerId);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    });
  });
});

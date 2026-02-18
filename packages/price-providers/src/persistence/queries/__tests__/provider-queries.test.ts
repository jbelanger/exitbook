import { Currency } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPricesDatabase, initializePricesDatabase, type PricesDB } from '../../database.js';
import type { CoinMappingInput } from '../provider-queries.js';
import { createProviderQueries, type ProviderQueries } from '../provider-queries.js';

function okValue<T>(result: Result<T, Error>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

describe('ProviderQueries', () => {
  let db: PricesDB;
  let queries: ProviderQueries;

  beforeEach(async () => {
    const dbResult = createPricesDatabase(':memory:');
    if (dbResult.isErr()) {
      throw dbResult.error;
    }
    db = dbResult.value;

    const migrationResult = await initializePricesDatabase(db);
    if (migrationResult.isErr()) {
      throw migrationResult.error;
    }

    queries = createProviderQueries(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function createProvider(name = 'coingecko', displayName = 'CoinGecko'): Promise<number> {
    return okValue(await queries.upsertProvider(name, displayName)).id;
  }

  it('creates a provider and returns same id for duplicate upserts', async () => {
    const first = okValue(await queries.upsertProvider('coingecko', 'CoinGecko'));
    const second = okValue(await queries.upsertProvider('coingecko', 'CoinGecko'));

    expect(first.id).toBe(second.id);
    expect(first.name).toBe('coingecko');
    expect(first.display_name).toBe('CoinGecko');
    expect(first.is_active).toBeTruthy();
  });

  it('returns undefined for unknown provider names', async () => {
    const value = okValue(await queries.getProviderByName('missing-provider'));

    expect(value).toBeUndefined();
  });

  it('updates provider sync metadata', async () => {
    const providerId = await createProvider();

    okValue(await queries.updateProviderSync(providerId, 5000));
    const provider = okValue(await queries.getProviderByName('coingecko'));

    expect(provider?.coin_list_count).toBe(5000);
    expect(provider?.last_coin_list_sync).toBeDefined();
  });

  it('replaces coin mappings and normalizes symbols', async () => {
    const providerId = await createProvider();

    okValue(
      await queries.upsertCoinMappings(providerId, [
        { symbol: 'BTC', coin_id: 'bitcoin', coin_name: 'Bitcoin' },
        { symbol: 'ETH', coin_id: 'ethereum', coin_name: 'Ethereum' },
      ])
    );

    okValue(
      await queries.upsertCoinMappings(providerId, [
        { symbol: 'btc', coin_id: 'bitcoin-new', coin_name: 'Bitcoin Updated' },
        { symbol: 'SOL', coin_id: 'solana', coin_name: 'Solana' },
      ])
    );

    const rows = okValue(await queries.getAllCoinMappings(providerId));
    expect(rows).toHaveLength(2);

    const btc = rows.find((row) => row.symbol === 'BTC');
    const sol = rows.find((row) => row.symbol === 'SOL');
    const eth = rows.find((row) => row.symbol === 'ETH');

    expect(btc?.coin_id).toBe('bitcoin-new');
    expect(btc?.priority).toBe(0);
    expect(sol).toBeDefined();
    expect(eth).toBeUndefined();
  });

  it('handles large coin mapping batches', async () => {
    const providerId = await createProvider();

    const mappings: CoinMappingInput[] = Array.from({ length: 1000 }, (_, index) => ({
      symbol: `TOKEN${index + 1}`,
      coin_id: `token-${index + 1}`,
      coin_name: `Token ${index + 1}`,
    }));

    okValue(await queries.upsertCoinMappings(providerId, mappings));

    const rows = okValue(await queries.getAllCoinMappings(providerId));
    expect(rows).toHaveLength(1000);
  });

  it('resolves coin ids by lowest priority number', async () => {
    const providerId = await createProvider();

    okValue(
      await queries.upsertCoinMappings(providerId, [
        { symbol: 'USDT', coin_id: 'tether-erc20', coin_name: 'Tether (ERC20)', priority: 2 },
        { symbol: 'USDT', coin_id: 'tether', coin_name: 'Tether', priority: 1 },
        { symbol: 'USDT', coin_id: 'tether-trc20', coin_name: 'Tether (TRC20)', priority: 3 },
      ])
    );

    const value = okValue(await queries.getCoinIdForSymbol(providerId, Currency.create('USDT')));
    expect(value).toBe('tether');
  });

  it('returns mappings scoped to one provider', async () => {
    const coingeckoId = await createProvider('coingecko', 'CoinGecko');
    const cryptocompareId = await createProvider('cryptocompare', 'CryptoCompare');

    okValue(
      await queries.upsertCoinMappings(coingeckoId, [{ symbol: 'BTC', coin_id: 'bitcoin', coin_name: 'Bitcoin' }])
    );
    okValue(
      await queries.upsertCoinMappings(cryptocompareId, [{ symbol: 'ETH', coin_id: 'ethereum', coin_name: 'Ethereum' }])
    );

    const geckoMappings = okValue(await queries.getAllCoinMappings(coingeckoId));
    const compareMappings = okValue(await queries.getAllCoinMappings(cryptocompareId));

    expect(geckoMappings).toHaveLength(1);
    expect(geckoMappings[0]?.symbol).toBe('BTC');
    expect(compareMappings).toHaveLength(1);
    expect(compareMappings[0]?.symbol).toBe('ETH');
  });

  it('returns an error when sync is checked for an unknown provider', async () => {
    const result = await queries.needsCoinListSync(999);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('not found');
    }
  });

  it('tracks sync freshness across never/recent/stale states', async () => {
    const providerId = await createProvider();

    const neverSynced = okValue(await queries.needsCoinListSync(providerId));
    expect(neverSynced).toBe(true);

    okValue(await queries.updateProviderSync(providerId, 5000));
    const recentlySynced = okValue(await queries.needsCoinListSync(providerId));
    expect(recentlySynced).toBe(false);

    const staleSync = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .updateTable('providers')
      .set({
        last_coin_list_sync: staleSync,
        coin_list_count: 5000,
      })
      .where('id', '=', providerId)
      .execute();

    const stale = okValue(await queries.needsCoinListSync(providerId));
    expect(stale).toBe(true);
  });
});

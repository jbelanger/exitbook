/* eslint-disable unicorn/no-null -- explicit null assertions for sqlite rows */
import { Currency, parseDecimal } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PriceData } from '../../../core/types.js';
import { createPricesDatabase, initializePricesDatabase, type PricesDB } from '../../database.js';
import { createPriceQueries, type PriceQueries } from '../price-queries.js';

function okValue<T>(result: Result<T, Error>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

function makePrice(overrides: Partial<PriceData> = {}): PriceData {
  return {
    assetSymbol: Currency.create('BTC'),
    currency: Currency.create('USD'),
    timestamp: new Date('2024-01-15T00:00:00.000Z'),
    price: parseDecimal('43000'),
    source: 'test-provider',
    fetchedAt: new Date('2024-01-15T12:00:00.000Z'),
    ...overrides,
  };
}

describe('PriceQueries', () => {
  let db: PricesDB;
  let queries: PriceQueries;

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

    queries = createPriceQueries(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('returns undefined when cache is empty', async () => {
    const value = okValue(
      await queries.getPrice(Currency.create('BTC'), Currency.create('USD'), new Date('2024-01-15T12:00:00.000Z'))
    );

    expect(value).toBeUndefined();
  });

  it('saves and fetches a price on the same day', async () => {
    okValue(await queries.savePrice(makePrice()));

    const value = okValue(
      await queries.getPrice(Currency.create('BTC'), Currency.create('USD'), new Date('2024-01-15T14:30:00.000Z'))
    );

    expect(value?.price).toEqual(parseDecimal('43000'));
    expect(value?.assetSymbol.toString()).toBe('BTC');
    expect(value?.currency.toString()).toBe('USD');
  });

  it('prefers minute bucket over hour/day buckets', async () => {
    okValue(
      await queries.savePrice(
        makePrice({
          timestamp: new Date('2024-01-15T00:00:00.000Z'),
          price: parseDecimal('1'),
          granularity: 'day',
        })
      )
    );
    okValue(
      await queries.savePrice(
        makePrice({
          timestamp: new Date('2024-01-15T14:00:00.000Z'),
          price: parseDecimal('2'),
          granularity: 'hour',
        })
      )
    );
    okValue(
      await queries.savePrice(
        makePrice({
          timestamp: new Date('2024-01-15T14:30:00.000Z'),
          price: parseDecimal('3'),
          granularity: 'minute',
        })
      )
    );

    const value = okValue(
      await queries.getPrice(Currency.create('BTC'), Currency.create('USD'), new Date('2024-01-15T14:30:45.123Z'))
    );

    expect(value?.price).toEqual(parseDecimal('3'));
    expect(value?.granularity).toBe('minute');
  });

  it('falls back to closest timestamp on the same day', async () => {
    okValue(
      await queries.savePrice(
        makePrice({ timestamp: new Date('2024-01-15T09:00:00.000Z'), price: parseDecimal('100') })
      )
    );
    okValue(
      await queries.savePrice(
        makePrice({ timestamp: new Date('2024-01-15T20:00:00.000Z'), price: parseDecimal('200') })
      )
    );

    const value = okValue(
      await queries.getPrice(Currency.create('BTC'), Currency.create('USD'), new Date('2024-01-15T11:00:00.000Z'))
    );

    expect(value?.price).toEqual(parseDecimal('100'));
  });

  it('upserts an existing price row', async () => {
    okValue(await queries.savePrice(makePrice({ price: parseDecimal('43000'), source: 'provider-a' })));
    okValue(await queries.savePrice(makePrice({ price: parseDecimal('43500'), source: 'provider-b' })));

    const value = okValue(
      await queries.getPrice(Currency.create('BTC'), Currency.create('USD'), new Date('2024-01-15T00:00:00.000Z'))
    );

    expect(value?.price).toEqual(parseDecimal('43500'));
    expect(value?.source).toBe('provider-b');
  });

  it('batch-saves prices and provider coin ids', async () => {
    const prices: PriceData[] = [
      makePrice({ assetSymbol: Currency.create('BTC') }),
      makePrice({ assetSymbol: Currency.create('ETH'), price: parseDecimal('2500') }),
    ];
    const coinIds = new Map<string, string>([
      ['BTC', 'bitcoin'],
      ['ETH', 'ethereum'],
    ]);

    okValue(await queries.savePrices(prices, coinIds));

    const rows = await db
      .selectFrom('prices')
      .select(['asset_symbol', 'provider_coin_id'])
      .orderBy('asset_symbol', 'asc')
      .execute();

    expect(rows).toEqual([
      { asset_symbol: 'BTC', provider_coin_id: 'bitcoin' },
      { asset_symbol: 'ETH', provider_coin_id: 'ethereum' },
    ]);
  });

  it('returns sorted range results and normalizes input case', async () => {
    okValue(
      await queries.savePrices([
        makePrice({ timestamp: new Date('2024-01-10T00:00:00.000Z'), price: parseDecimal('40000') }),
        makePrice({ timestamp: new Date('2024-01-15T00:00:00.000Z'), price: parseDecimal('43000') }),
        makePrice({ timestamp: new Date('2024-01-20T00:00:00.000Z'), price: parseDecimal('45000') }),
      ])
    );

    const value = okValue(
      await queries.getPriceRange(
        'btc',
        'usd',
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-31T00:00:00.000Z')
      )
    );

    expect(value.map((entry) => entry.price.toFixed())).toEqual(['40000', '43000', '45000']);
  });

  it('checks existence by day regardless of timestamp time', async () => {
    okValue(await queries.savePrice(makePrice({ timestamp: new Date('2024-01-15T00:00:00.000Z') })));

    const hasSameDay = okValue(await queries.hasPrice('BTC', 'USD', new Date('2024-01-15T18:30:00.000Z')));
    const missingDay = okValue(await queries.hasPrice('BTC', 'USD', new Date('2024-01-16T18:30:00.000Z')));

    expect(hasSameDay).toBe(true);
    expect(missingDay).toBe(false);
  });

  it('normalizes missing granularity to undefined when reading cache rows', async () => {
    await db
      .insertInto('prices')
      .values({
        asset_symbol: 'BTC',
        currency: 'USD',
        timestamp: '2024-01-15T00:00:00.000Z',
        price: '43000',
        source_provider: 'coingecko',
        provider_coin_id: null,
        granularity: undefined,
        fetched_at: '2024-01-15T12:00:00.000Z',
        updated_at: null,
      })
      .execute();

    const value = okValue(
      await queries.getPrice(Currency.create('BTC'), Currency.create('USD'), new Date('2024-01-15T08:30:00.000Z'))
    );

    expect(value?.granularity).toBeUndefined();
  });
});

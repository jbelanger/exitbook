import { Currency } from '@exitbook/core';
import { configureLogger } from '@exitbook/shared-logger';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initializePricesDatabase, type PricesDB } from '../../persistence/database.js';
import type { PricesDatabase } from '../../persistence/schema.js';
import { createBinanceProvider, type BinanceProvider } from '../provider.js';

/**
 * E2E tests for Binance provider
 *
 * These tests make real API calls to Binance's free public API
 * No API key required, but rate limits apply (6000 weight/hour)
 */
describe('Binance Provider E2E', () => {
  let db: PricesDB;
  let sqliteDb: Database.Database;
  let provider: BinanceProvider;

  beforeAll(async () => {
    // Enable logging in tests
    configureLogger({
      spinner: {
        start: () => void {},
        stop: () => void {},
        message: () => void {},
      },
      mode: 'text',
      verbose: true, // Show debug logs
    });

    // Create in-memory database for testing
    sqliteDb = new Database(':memory:');

    // Configure SQLite pragmas
    sqliteDb.pragma('foreign_keys = ON');

    // Create Kysely instance
    db = new Kysely<PricesDatabase>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });

    // Run migrations
    const migrationsResult = await initializePricesDatabase(db);
    if (migrationsResult.isErr()) {
      throw migrationsResult.error;
    }

    // Create provider using free tier (no API key)
    const providerResult = createBinanceProvider(db, {});

    if (providerResult.isErr()) {
      throw providerResult.error;
    }

    provider = providerResult.value;
  }, 30000);

  afterAll(async () => {
    await db.destroy();
    sqliteDb.close();
  });

  it('should fetch current Bitcoin price in USDT', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: new Date(), // Current time - uses minute data
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.currency.toString()).toBe('USDT');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeLessThan(200000); // Sanity check - BTC < $200k
      expect(priceData.source).toBe('binance');
      expect(priceData.granularity).toBe('minute');
    }
  }, 30000);

  it('should fetch historical Bitcoin price from 1 week ago', async () => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: oneWeekAgo,
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.currency.toString()).toBe('USDT');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.source).toBe('binance');
      expect(priceData.granularity).toBe('minute'); // Within 1 year, should use minute data
    }
  }, 30000);

  it('should fetch Ethereum price in USD', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('ETH'),
      currency: Currency.create('USD'),
      timestamp: new Date(),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('ETH');
      // Binance may return USDT as it's more common
      expect(['USD', 'USDT']).toContain(priceData.currency.toString());
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeLessThan(20000); // Sanity check - ETH < $20k
      expect(priceData.source).toBe('binance');
    }
  }, 30000);

  it('should fetch BNB price in USDT', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('BNB'),
      currency: Currency.create('USDT'),
      timestamp: new Date(),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BNB');
      expect(priceData.currency.toString()).toBe('USDT');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.source).toBe('binance');
    }
  }, 30000);

  it('should use cache for repeated requests', async () => {
    const timestamp = new Date('2024-01-15T12:00:00Z');

    // First request - should fetch from API
    const firstResult = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp,
    });

    expect(firstResult.isOk()).toBe(true);

    // Second request - should use cache
    const secondResult = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp,
    });

    expect(secondResult.isOk()).toBe(true);

    if (firstResult.isOk() && secondResult.isOk()) {
      expect(firstResult.value.price).toBe(secondResult.value.price);
      expect(firstResult.value.timestamp.getTime()).toBe(secondResult.value.timestamp.getTime());
    }
  }, 30000);

  it('should return CoinNotFoundError for invalid symbol', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('INVALIDCOIN123'),
      currency: Currency.create('USDT'),
      timestamp: new Date(),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toMatch(/Binance does not have data|returned no data/i);
    }
  }, 30000);

  it('should handle very old historical date (use daily data)', async () => {
    const oldDate = new Date('2020-01-01T00:00:00Z');

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: oldDate,
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.granularity).toBe('day'); // Old data should use daily granularity
    }
  }, 30000);

  it('should fetch price for altcoin with lower market cap', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('MATIC'),
      currency: Currency.create('USDT'),
      timestamp: new Date(),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('MATIC');
      expect(priceData.currency.toString()).toBe('USDT');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.source).toBe('binance');
    }
  }, 30000);

  it('should respect provider metadata', () => {
    const metadata = provider.getMetadata();

    expect(metadata.name).toBe('binance');
    expect(metadata.displayName).toBe('Binance');
    expect(metadata.requiresApiKey).toBe(false);
    expect(metadata.capabilities.supportedCurrencies).toContain('USDT');
    expect(metadata.capabilities.supportedCurrencies).toContain('USD');
    expect(metadata.capabilities.supportedOperations).toContain('fetchPrice');

    // Check granularity support
    const granularitySupport = metadata.capabilities.granularitySupport;
    expect(granularitySupport).toBeDefined();
    expect(granularitySupport?.some((g) => g.granularity === 'minute')).toBe(true);
    expect(granularitySupport?.some((g) => g.granularity === 'day')).toBe(true);

    // Minute data should have ~1 year limit
    const minuteSupport = granularitySupport?.find((g) => g.granularity === 'minute');
    expect(minuteSupport?.maxHistoryDays).toBe(365);
  });
});

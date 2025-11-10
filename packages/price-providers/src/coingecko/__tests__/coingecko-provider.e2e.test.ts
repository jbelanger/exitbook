import { Currency } from '@exitbook/core';
import { configureLogger } from '@exitbook/shared-logger';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initializePricesDatabase, type PricesDB } from '../../persistence/database.js';
import type { PricesDatabase } from '../../persistence/schema.js';
import { createCoinGeckoProvider, type CoinGeckoProvider } from '../provider.js';

/**
 * E2E tests for CoinGecko provider
 *
 * These tests make real API calls to CoinGecko's free API
 * No API key required, but rate limits apply
 */
describe('CoinGecko Provider E2E', () => {
  let db: PricesDB;
  let sqliteDb: Database.Database;
  let provider: CoinGeckoProvider;

  beforeAll(async () => {
    // Enable logging in tests by configuring a fake spinner
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
    const providerResult = createCoinGeckoProvider(db, {
      useProApi: false,
    });

    if (providerResult.isErr()) {
      throw providerResult.error;
    }

    provider = providerResult.value;

    // Initialize provider ONCE for all tests to avoid rate limiting
    const initResult = await provider.initialize();
    if (initResult.isErr()) {
      throw initResult.error;
    }
  }, 180000);

  afterAll(async () => {
    await db.destroy();
    sqliteDb.close();
  });

  it('should have synced coin list from CoinGecko API', async () => {
    // Verify sync happened in beforeAll by checking we can fetch BTC
    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: new Date(),
    });

    expect(result.isOk()).toBe(true);
  }, 180000);

  it('should fetch current Bitcoin price in USD', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: new Date(), // Current time - uses simple price API
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeGreaterThan(10000); // BTC is typically > $10k
      expect(priceData.source).toBe('coingecko');
      expect(priceData.fetchedAt).toBeInstanceOf(Date);
    }
  }, 180000);

  it('should fetch historical Bitcoin price', async () => {
    // Use a date from 30 days ago (free API allows 365 days of historical data)
    const historicalDate = new Date();
    historicalDate.setDate(historicalDate.getUTCDate() - 30);
    historicalDate.setUTCHours(0, 0, 0, 0); // Reset to start of day (UTC)

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: historicalDate,
    });

    if (result.isErr()) {
      console.log(result.error);
    }

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeGreaterThan(1000); // BTC should be > $1000
      expect(priceData.source).toBe('coingecko');
      // Dates should match (ignoring time portion)
      expect(priceData.timestamp.toISOString().split('T')[0]).toEqual(historicalDate.toISOString().split('T')[0]);
    }
  }, 180000);

  it('should fetch current Ethereum price in EUR', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('ETH'),
      currency: Currency.create('EUR'),
      timestamp: new Date(),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('ETH');
      expect(priceData.currency.toString()).toBe('EUR');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeGreaterThan(500); // ETH is typically > €500
      expect(priceData.source).toBe('coingecko');
    }
  }, 180000);

  it('should use cache on second fetch of same price', async () => {
    // Use a date from 7 days ago (within free API range)
    const queryDate = new Date();
    queryDate.setDate(queryDate.getUTCDate() - 7);
    queryDate.setUTCHours(0, 0, 0, 0); // Use UTC to match cache rounding

    const query = {
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: queryDate,
    };

    // First fetch - should hit API
    const result1 = await provider.fetchPrice(query);

    if (result1.isErr()) {
      console.log(result1.error);
    }

    expect(result1.isOk()).toBe(true);

    if (result1.isOk()) {
      const fetchedAt1 = result1.value.fetchedAt;

      // Second fetch - should use cache
      const result2 = await provider.fetchPrice(query);
      expect(result2.isOk()).toBe(true);

      if (result2.isOk()) {
        const fetchedAt2 = result2.value.fetchedAt;

        // Fetched timestamps should match (indicating cache hit)
        expect(fetchedAt1.getTime()).toBe(fetchedAt2.getTime());

        // Prices should match
        expect(result1.value.price).toBe(result2.value.price);
      }
    }
  }, 180000);

  it('should return error for unknown asset', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('NOTAREALCOIN123'),
      currency: Currency.create('USD'),
      timestamp: new Date(),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toContain('No CoinGecko coin ID found');
    }
  }, 180000);

  it('should skip sync when already initialized recently', async () => {
    // Initialize was already done in beforeAll
    // Calling initialize again should skip sync (within 7-day sync window) and succeed quickly
    const result = await provider.initialize();
    expect(result.isOk()).toBe(true);

    // Should still be able to fetch prices
    const priceResult = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: new Date(),
    });

    expect(priceResult.isOk()).toBe(true);
  }, 180000);
});

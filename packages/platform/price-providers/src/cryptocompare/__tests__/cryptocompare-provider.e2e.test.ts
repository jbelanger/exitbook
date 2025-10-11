import { Currency } from '@exitbook/core';
import { configureLogger } from '@exitbook/shared-logger';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initializePricesDatabase, type PricesDB } from '../../pricing/database.js';
import type { PricesDatabase } from '../../pricing/schema.js';
import { createCryptoCompareProvider, type CryptoCompareProvider } from '../provider.js';

/**
 * E2E tests for CryptoCompare provider
 *
 * These tests make real API calls to CryptoCompare's free API
 * No API key required, but rate limits apply (~100,000 calls/month)
 */
describe('CryptoCompare Provider E2E', () => {
  let db: PricesDB;
  let sqliteDb: Database.Database;
  let provider: CryptoCompareProvider;

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
    const providerResult = createCryptoCompareProvider(db, {});

    if (providerResult.isErr()) {
      throw providerResult.error;
    }

    provider = providerResult.value;
  }, 30000);

  afterAll(async () => {
    await db.destroy();
    sqliteDb.close();
  });

  it('should fetch current Bitcoin price in USD', async () => {
    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: new Date(), // Current time - uses current price API
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeGreaterThan(10000); // BTC is typically > $10k
      expect(priceData.source).toBe('cryptocompare');
      expect(priceData.fetchedAt).toBeInstanceOf(Date);
    }
  }, 30000);

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
      expect(priceData.source).toBe('cryptocompare');
    }
  }, 30000);

  it('should fetch historical Bitcoin price using minute data', async () => {
    // Use a date from 2 days ago (within minute data range ~7 days)
    const historicalDate = new Date();
    historicalDate.setDate(historicalDate.getDate() - 2);
    historicalDate.setUTCHours(12, 0, 0, 0); // Noon UTC

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: historicalDate,
    });

    if (result.isErr()) {
      console.log('Historical minute error:', result.error);
    }

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeGreaterThan(1000); // BTC should be > $1000
      expect(priceData.source).toBe('cryptocompare');
    }
  }, 30000);

  it('should fetch historical Bitcoin price using hour data', async () => {
    // Use a date from 30 days ago (within hour data range ~90 days)
    const historicalDate = new Date();
    historicalDate.setDate(historicalDate.getDate() - 30);
    historicalDate.setUTCHours(12, 0, 0, 0); // Noon UTC

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: historicalDate,
    });

    if (result.isErr()) {
      console.log('Historical hour error:', result.error);
    }

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeGreaterThan(1000); // BTC should be > $1000
      expect(priceData.source).toBe('cryptocompare');
    }
  }, 30000);

  it('should fetch historical Bitcoin price using day data', async () => {
    // Use a date from 180 days ago (uses day data)
    const historicalDate = new Date();
    historicalDate.setDate(historicalDate.getDate() - 180);
    historicalDate.setUTCHours(0, 0, 0, 0); // Start of day UTC

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: historicalDate,
    });

    if (result.isErr()) {
      console.log('Historical day error:', result.error);
    }

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.asset.toString()).toBe('BTC');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeGreaterThan(1000); // BTC should be > $1000
      expect(priceData.source).toBe('cryptocompare');
    }
  }, 30000);

  it('should use cache on second fetch of same price', async () => {
    // Use a date from 10 days ago
    const queryDate = new Date();
    queryDate.setDate(queryDate.getDate() - 10);
    queryDate.setUTCHours(12, 0, 0, 0); // Noon UTC

    const query = {
      asset: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: queryDate,
    };

    // First fetch - should hit API
    const result1 = await provider.fetchPrice(query);

    if (result1.isErr()) {
      console.log('First fetch error:', result1.error);
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
  }, 30000);

  it('should batch fetch multiple current prices', async () => {
    const now = new Date();
    const result = await provider.fetchBatch([
      { asset: Currency.create('BTC'), currency: Currency.create('USD'), timestamp: now },
      { asset: Currency.create('ETH'), currency: Currency.create('USD'), timestamp: now },
      { asset: Currency.create('BNB'), currency: Currency.create('USD'), timestamp: now },
    ]);

    if (result.isErr()) {
      console.log('Batch fetch error:', result.error);
    }

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const prices = result.value;
      expect(prices.length).toBeGreaterThan(0);

      // Check BTC price if present
      const btcPrice = prices.find((p) => p.asset.toString() === 'BTC');
      if (btcPrice) {
        expect(btcPrice.currency.toString()).toBe('USD');
        expect(btcPrice.price).toBeGreaterThan(0);
        expect(btcPrice.source).toBe('cryptocompare');
      }

      // Check ETH price if present
      const ethPrice = prices.find((p) => p.asset.toString() === 'ETH');
      if (ethPrice) {
        expect(ethPrice.currency.toString()).toBe('USD');
        expect(ethPrice.price).toBeGreaterThan(0);
        expect(ethPrice.source).toBe('cryptocompare');
      }
    }
  }, 30000);

  it('should fetch prices for multiple popular cryptocurrencies', async () => {
    const now = new Date();
    const currencies = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'MATIC'];

    for (const symbol of currencies) {
      const result = await provider.fetchPrice({
        asset: Currency.create(symbol),
        currency: Currency.create('USD'),
        timestamp: now,
      });

      if (result.isErr()) {
        console.log(`Failed to fetch ${symbol}:`, result.error);
      }

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        expect(result.value.asset.toString()).toBe(symbol);
        expect(result.value.price).toBeGreaterThan(0);
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }, 60000);

  it('should handle mixed batch with recent and historical prices', async () => {
    const now = new Date();
    const historical = new Date();
    historical.setDate(historical.getDate() - 5);

    const result = await provider.fetchBatch([
      { asset: Currency.create('BTC'), currency: Currency.create('USD'), timestamp: now },
      { asset: Currency.create('ETH'), currency: Currency.create('USD'), timestamp: historical },
    ]);

    if (result.isErr()) {
      console.log('Mixed batch error:', result.error);
    }

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const prices = result.value;
      expect(prices.length).toBeGreaterThan(0);

      // Should have at least one price
      expect(prices[0]).toBeDefined();
      expect(prices[0]?.price).toBeGreaterThan(0);
      expect(prices[0]?.source).toBe('cryptocompare');
    }
  }, 60000);
});

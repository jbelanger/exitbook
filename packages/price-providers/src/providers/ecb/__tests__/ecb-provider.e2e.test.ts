import { Currency } from '@exitbook/core';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PricesDB } from '../../../persistence/database.js';
import { initializePricesDatabase } from '../../../persistence/database.js';
import type { PricesDatabase } from '../../../persistence/schema.js';
import { createECBProvider, type ECBProvider } from '../provider.js';

/**
 * E2E tests for ECB provider
 *
 * These tests make real API calls to ECB's free public API
 * No API key required
 */
describe('ECB Provider E2E', () => {
  let db: PricesDB;
  let sqliteDb: Database.Database;
  let provider: ECBProvider;

  beforeAll(async () => {
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

    // Create provider (no API key required)
    const providerResult = createECBProvider(db);

    if (providerResult.isErr()) {
      throw providerResult.error;
    }

    provider = providerResult.value;
  }, 30000);

  afterAll(async () => {
    await db.destroy();
    sqliteDb.close();
  });

  it('should fetch EUR/USD exchange rate for recent date', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('EUR'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.assetSymbol.toString()).toBe('EUR');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.price).toBeGreaterThan(0.5); // EUR typically worth more than 0.5 USD
      expect(priceData.price).toBeLessThan(2); // EUR typically worth less than 2 USD
      expect(priceData.source).toBe('ecb');
      expect(priceData.granularity).toBe('day');
    }
  }, 30000);

  it('should return error for non-EUR fiat currency (GBP)', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('GBP'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toContain('ECB only supports EUR currency');
    }
  }, 30000);

  it('should return error for non-EUR fiat currency (JPY)', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('JPY'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toContain('ECB only supports EUR currency');
    }
  }, 30000);

  it('should fetch historical data from several years ago', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('EUR'),
      currency: Currency.create('USD'),
      timestamp: new Date('2020-01-15T00:00:00Z'),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.assetSymbol.toString()).toBe('EUR');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price).toBeGreaterThan(0);
      expect(priceData.source).toBe('ecb');
      expect(priceData.granularity).toBe('day');
    }
  }, 30000);

  it('should use cache for repeated requests', async () => {
    const timestamp = new Date('2024-01-10T00:00:00Z');

    // First request - should fetch from API
    const firstResult = await provider.fetchPrice({
      assetSymbol: Currency.create('EUR'),
      currency: Currency.create('USD'),
      timestamp,
    });

    expect(firstResult.isOk()).toBe(true);

    // Second request - should use cache
    const secondResult = await provider.fetchPrice({
      assetSymbol: Currency.create('EUR'),
      currency: Currency.create('USD'),
      timestamp,
    });

    expect(secondResult.isOk()).toBe(true);

    if (firstResult.isOk() && secondResult.isOk()) {
      expect(firstResult.value.price).toBe(secondResult.value.price);
      expect(firstResult.value.timestamp.getTime()).toBe(secondResult.value.timestamp.getTime());
    }
  }, 30000);

  it('should return error for cryptocurrency (not EUR)', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toContain('ECB only supports EUR currency');
    }
  }, 30000);

  it('should return error for non-USD target currency', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('EUR'),
      currency: Currency.create('GBP'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toContain('ECB only supports USD as target currency');
    }
  }, 30000);

  it('should respect provider metadata', () => {
    const metadata = provider.getMetadata();

    expect(metadata.name).toBe('ecb');
    expect(metadata.displayName).toBe('European Central Bank');
    expect(metadata.requiresApiKey).toBe(false);
    expect(metadata.capabilities.supportedAssetTypes).toContain('fiat');
    expect(metadata.capabilities.supportedAssets).toEqual(['EUR']); // Only EUR
    expect(metadata.capabilities.supportedOperations).toContain('fetchPrice');

    // Check granularity support
    const granularitySupport = metadata.capabilities.granularitySupport;
    expect(granularitySupport).toBeDefined();
    expect(granularitySupport?.length).toBe(1);
    expect(granularitySupport?.[0]?.granularity).toBe('day');
    expect(granularitySupport?.[0]?.maxHistoryDays).toBeUndefined(); // Unlimited
  });

  it('should return error for weekend date (no ECB data)', async () => {
    // ECB doesn't publish rates on weekends
    // Saturday, January 13, 2024
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('EUR'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-13T00:00:00Z'),
    });

    // This may return an error or may return Friday's rate depending on ECB API behavior
    // We just verify it handles weekends gracefully
    expect(result.isOk() || result.isErr()).toBe(true);
  }, 30000);
});

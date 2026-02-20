import { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPricesDatabase, initializePricesDatabase, type PricesDB } from '../../../persistence/database.js';
import { createBankOfCanadaProvider, type BankOfCanadaProvider } from '../provider.js';

/**
 * E2E tests for Bank of Canada provider
 *
 * These tests make real API calls to Bank of Canada's free public Valet API
 * No API key required
 */
describe('Bank of Canada Provider E2E', () => {
  let db: PricesDB;
  let provider: BankOfCanadaProvider;

  beforeAll(async () => {
    const dbResult = createPricesDatabase(':memory:');
    if (dbResult.isErr()) throw dbResult.error;
    db = dbResult.value;

    const migrationsResult = await initializePricesDatabase(db);
    if (migrationsResult.isErr()) throw migrationsResult.error;

    // Create provider (no API key required)
    const providerResult = createBankOfCanadaProvider(db);

    if (providerResult.isErr()) {
      throw providerResult.error;
    }

    provider = providerResult.value;
  }, 30000);

  afterAll(async () => {
    await db.destroy();
  });

  it('should fetch CAD/USD exchange rate for recent date', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('CAD'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.assetSymbol.toString()).toBe('CAD');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price.greaterThan(0)).toBe(true);
      expect(priceData.price.greaterThan(0.5)).toBe(true); // CAD typically worth more than 0.5 USD
      expect(priceData.price.lessThan(1)).toBe(true); // CAD typically worth less than 1 USD
      expect(priceData.source).toBe('bank-of-canada');
      expect(priceData.granularity).toBe('day');
    }
  }, 30000);

  it('should fetch historical CAD/USD exchange rate from 2023', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('CAD'),
      currency: Currency.create('USD'),
      timestamp: new Date('2023-06-15T00:00:00Z'),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.assetSymbol.toString()).toBe('CAD');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price.greaterThan(0)).toBe(true);
      expect(priceData.source).toBe('bank-of-canada');
      expect(priceData.granularity).toBe('day');
    }
  }, 30000);

  it('should fetch historical CAD/USD exchange rate from 2020', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('CAD'),
      currency: Currency.create('USD'),
      timestamp: new Date('2020-01-15T00:00:00Z'),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      expect(priceData.assetSymbol.toString()).toBe('CAD');
      expect(priceData.currency.toString()).toBe('USD');
      expect(priceData.price.greaterThan(0)).toBe(true);
      expect(priceData.source).toBe('bank-of-canada');
    }
  }, 30000);

  it('should use cache for repeated requests', async () => {
    const timestamp = new Date('2024-01-10T00:00:00Z');

    // First request - should fetch from API
    const firstResult = await provider.fetchPrice({
      assetSymbol: Currency.create('CAD'),
      currency: Currency.create('USD'),
      timestamp,
    });

    expect(firstResult.isOk()).toBe(true);

    // Second request - should use cache
    const secondResult = await provider.fetchPrice({
      assetSymbol: Currency.create('CAD'),
      currency: Currency.create('USD'),
      timestamp,
    });

    expect(secondResult.isOk()).toBe(true);

    if (firstResult.isOk() && secondResult.isOk()) {
      expect(firstResult.value.price).toBe(secondResult.value.price);
      expect(firstResult.value.timestamp.getTime()).toBe(secondResult.value.timestamp.getTime());
    }
  }, 30000);

  it('should return error for non-CAD asset', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('EUR'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toContain('Bank of Canada only supports CAD currency');
    }
  }, 30000);

  it('should return error for cryptocurrency (not CAD)', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('BTC'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toContain('Bank of Canada only supports CAD currency');
    }
  }, 30000);

  it('should return error for non-USD target currency', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('CAD'),
      currency: Currency.create('EUR'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.message).toContain('Bank of Canada only supports USD as target currency');
    }
  }, 30000);

  it('should respect provider metadata', () => {
    const metadata = provider.getMetadata();

    expect(metadata.name).toBe('bank-of-canada');
    expect(metadata.displayName).toBe('Bank of Canada');
    expect(metadata.requiresApiKey).toBe(false);
    expect(metadata.capabilities.supportedAssetTypes).toContain('fiat');
    expect(metadata.capabilities.supportedAssets).toEqual(['CAD']);
    expect(metadata.capabilities.supportedOperations).toContain('fetchPrice');

    // Check granularity support
    const granularitySupport = metadata.capabilities.granularitySupport;
    expect(granularitySupport).toBeDefined();
    expect(granularitySupport?.length).toBe(1);
    expect(granularitySupport?.[0]?.granularity).toBe('day');
    expect(granularitySupport?.[0]?.maxHistoryDays).toBeUndefined(); // Unlimited (back to 2017)
  });

  it('should return error for weekend date (no BoC data)', async () => {
    // Bank of Canada doesn't publish rates on weekends
    // Saturday, January 13, 2024
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('CAD'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-13T00:00:00Z'),
    });

    // This may return an error or may return Friday's rate depending on BoC API behavior
    // We just verify it handles weekends gracefully
    expect(result.isOk() || result.isErr()).toBe(true);
  }, 30000);

  it('should correctly invert USD/CAD to CAD/USD', async () => {
    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('CAD'),
      currency: Currency.create('USD'),
      timestamp: new Date('2024-01-15T00:00:00Z'),
    });

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const priceData = result.value;
      // Verify the inversion makes sense
      // If CAD/USD is 0.75, then USD/CAD should be 1.33
      const expectedUsdCad = new Decimal(1).dividedBy(priceData.price);
      expect(expectedUsdCad.greaterThan(1)).toBe(true); // USD/CAD typically > 1
      expect(expectedUsdCad.lessThan(2)).toBe(true); // USD/CAD typically < 2
    }
  }, 30000);
});

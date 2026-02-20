/**
 * E2E tests for Frankfurter provider
 *
 * These tests make real API calls to Frankfurter's free public API
 * No API key required
 */

import { Currency } from '@exitbook/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPricesDatabase, initializePricesDatabase, type PricesDB } from '../../../persistence/database.js';
import { createFrankfurterProvider, type FrankfurterProvider } from '../provider.js';

describe('Frankfurter Provider E2E', () => {
  let db: PricesDB;
  let provider: FrankfurterProvider;

  beforeAll(async () => {
    const dbResult = createPricesDatabase(':memory:');
    if (dbResult.isErr()) throw dbResult.error;
    db = dbResult.value;

    const migrationsResult = await initializePricesDatabase(db);
    if (migrationsResult.isErr()) throw migrationsResult.error;

    // Create provider (no API key required)
    const providerResult = createFrankfurterProvider(db);

    if (providerResult.isErr()) {
      throw providerResult.error;
    }

    provider = providerResult.value;
  }, 30000);

  afterAll(async () => {
    await db.destroy();
  });

  describe('EUR conversions', () => {
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
        expect(priceData.price).toBeGreaterThan(0.5);
        expect(priceData.price).toBeLessThan(2);
        expect(priceData.source).toBe('frankfurter');
        expect(priceData.granularity).toBe('day');
      }
    }, 30000);
  });

  describe('CAD conversions', () => {
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
        expect(priceData.price).toBeGreaterThan(0);
        expect(priceData.price).toBeGreaterThan(0.5); // CAD typically worth more than 0.5 USD
        expect(priceData.price).toBeLessThan(1.5); // CAD typically worth less than 1.5 USD
        expect(priceData.source).toBe('frankfurter');
        expect(priceData.granularity).toBe('day');
      }
    }, 30000);
  });

  describe('GBP conversions', () => {
    it('should fetch GBP/USD exchange rate for recent date', async () => {
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('GBP'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const priceData = result.value;
        expect(priceData.assetSymbol.toString()).toBe('GBP');
        expect(priceData.currency.toString()).toBe('USD');
        expect(priceData.price).toBeGreaterThan(1.0); // GBP typically worth more than 1 USD
        expect(priceData.price).toBeLessThan(2.0); // GBP typically worth less than 2 USD
        expect(priceData.source).toBe('frankfurter');
        expect(priceData.granularity).toBe('day');
      }
    }, 30000);
  });

  describe('JPY conversions', () => {
    it('should fetch JPY/USD exchange rate for recent date', async () => {
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('JPY'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const priceData = result.value;
        expect(priceData.assetSymbol.toString()).toBe('JPY');
        expect(priceData.currency.toString()).toBe('USD');
        expect(priceData.price).toBeGreaterThan(0);
        expect(priceData.price).toBeLessThan(1); // JPY typically worth less than 1 USD
        expect(priceData.source).toBe('frankfurter');
        expect(priceData.granularity).toBe('day');
      }
    }, 30000);
  });

  describe('CHF conversions', () => {
    it('should fetch CHF/USD exchange rate for recent date', async () => {
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('CHF'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const priceData = result.value;
        expect(priceData.assetSymbol.toString()).toBe('CHF');
        expect(priceData.currency.toString()).toBe('USD');
        expect(priceData.price).toBeGreaterThan(0.5);
        expect(priceData.price).toBeLessThan(1.5);
        expect(priceData.source).toBe('frankfurter');
        expect(priceData.granularity).toBe('day');
      }
    }, 30000);
  });

  describe('Special cases', () => {
    it('should handle USD/USD as 1.0', async () => {
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('USD'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const priceData = result.value;
        expect(priceData.assetSymbol.toString()).toBe('USD');
        expect(priceData.currency.toString()).toBe('USD');
        expect(priceData.price).toBe(1.0);
        expect(priceData.source).toBe('frankfurter');
      }
    }, 30000);

    it('should handle weekend dates (use previous business day)', async () => {
      // Saturday, January 13, 2024
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('EUR'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-13T00:00:00Z'),
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const priceData = result.value;
        expect(priceData.assetSymbol.toString()).toBe('EUR');
        expect(priceData.currency.toString()).toBe('USD');
        expect(priceData.price).toBeGreaterThan(0);
        expect(priceData.granularity).toBe('day');
      }
    }, 30000);
  });

  describe('Historical data', () => {
    it('should fetch historical rates from early 2000s', async () => {
      // Frankfurter has data back to 1999, but using 2000 for more reliable test
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('EUR'),
        currency: Currency.create('USD'),
        timestamp: new Date('2000-01-03T00:00:00Z'), // First business day of 2000
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const priceData = result.value;
        expect(priceData.assetSymbol.toString()).toBe('EUR');
        expect(priceData.currency.toString()).toBe('USD');
        expect(priceData.price).toBeGreaterThan(0);
        expect(priceData.source).toBe('frankfurter');
      }
    }, 30000);

    it('should fetch rates from 2020 (COVID period)', async () => {
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('CAD'),
        currency: Currency.create('USD'),
        timestamp: new Date('2020-06-30T00:00:00Z'),
      });

      expect(result.isOk()).toBe(true);

      if (result.isOk()) {
        const priceData = result.value;
        expect(priceData.assetSymbol.toString()).toBe('CAD');
        expect(priceData.currency.toString()).toBe('USD');
        expect(priceData.price).toBeGreaterThan(0);
      }
    }, 30000);
  });

  describe('Error handling', () => {
    it('should return error for unsupported crypto currency', async () => {
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('BTC'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      expect(result.isErr()).toBe(true);

      if (result.isErr()) {
        expect(result.error.message).toContain('Frankfurter only supports fiat currencies');
      }
    }, 30000);

    it('should return error for non-USD target currency', async () => {
      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('EUR'),
        currency: Currency.create('CAD'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      expect(result.isErr()).toBe(true);

      if (result.isErr()) {
        expect(result.error.message).toContain('only supports USD as target currency');
      }
    }, 30000);
  });

  describe('Caching', () => {
    it('should cache results and return from cache on second request', async () => {
      const query = {
        assetSymbol: Currency.create('EUR'),
        currency: Currency.create('USD'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      };

      // First request - fetches from API
      const result1 = await provider.fetchPrice(query);
      expect(result1.isOk()).toBe(true);

      // Second request - should use cache
      const result2 = await provider.fetchPrice(query);
      expect(result2.isOk()).toBe(true);

      // Results should be identical
      if (result1.isOk() && result2.isOk()) {
        expect(result1.value.price).toBe(result2.value.price);
        expect(result1.value.source).toBe(result2.value.source);
      }
    }, 30000);
  });

  describe('Provider metadata', () => {
    it('should have correct metadata', () => {
      const metadata = provider.getMetadata();

      expect(metadata.name).toBe('frankfurter');
      expect(metadata.displayName).toBe('Frankfurter (ECB)');
      expect(metadata.requiresApiKey).toBe(false);
      expect(metadata.capabilities.supportedAssetTypes).toContain('fiat');
      expect(metadata.capabilities.supportedOperations).toContain('fetchPrice');
    });

    it('should list all 31 supported currencies', () => {
      const metadata = provider.getMetadata();

      expect(metadata.capabilities.supportedAssets).toBeDefined();
      expect(
        Array.isArray(metadata.capabilities.supportedAssets) ? metadata.capabilities.supportedAssets.length : 0
      ).toBe(31);
      expect(metadata.capabilities.supportedAssets).toContain('USD');
      expect(metadata.capabilities.supportedAssets).toContain('EUR');
      expect(metadata.capabilities.supportedAssets).toContain('CAD');
      expect(metadata.capabilities.supportedAssets).toContain('GBP');
      expect(metadata.capabilities.supportedAssets).toContain('JPY');
    });
  });
});

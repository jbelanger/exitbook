/**
 * Tests for ManualPriceService
 *
 * Verifies manual price and FX rate entry functionality
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { type Currency, parseDecimal } from '@exitbook/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPricesDatabase, initializePricesDatabase, type PricesDB } from '../../persistence/database.js';
import { createPriceQueries, type PriceQueries } from '../../persistence/queries/price-queries.js';
import { ManualPriceService, saveManualFxRate, saveManualPrice } from '../manual-price-service.js';

describe('ManualPriceService', () => {
  let db: PricesDB;
  let queries: PriceQueries;
  let testDbPath: string;

  beforeEach(async () => {
    // Create a temporary database file path
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-price-service-test-'));
    testDbPath = path.join(tmpDir, 'test.db');

    // Create database
    const dbResult = createPricesDatabase(testDbPath);
    if (dbResult.isErr()) {
      throw dbResult.error;
    }
    db = dbResult.value;

    // Run migrations
    const migrationResult = await initializePricesDatabase(db);
    if (migrationResult.isErr()) {
      throw migrationResult.error;
    }

    queries = createPriceQueries(db);
  });

  afterEach(async () => {
    await db.destroy();
    // Clean up test database file
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      // Remove the temp directory
      const tmpDir = path.dirname(testDbPath);
      if (fs.existsSync(tmpDir)) {
        fs.rmdirSync(tmpDir);
      }
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('savePrice', () => {
    it('should save a manual price entry with defaults', async () => {
      const service = new ManualPriceService(testDbPath);

      const result = await service.savePrice({
        assetSymbol: 'BTC',
        date: new Date('2024-01-15T10:30:00Z'),
        price: parseDecimal('45000'),
      });

      expect(result.isOk()).toBe(true);

      // Verify the price was saved
      const priceResult = await queries.getPrice(
        'BTC' as Currency,
        'USD' as Currency,
        new Date('2024-01-15T10:30:00Z')
      );

      expect(priceResult.isOk()).toBe(true);
      if (priceResult.isOk()) {
        expect(priceResult.value).toBeDefined();
        expect(priceResult.value?.price.toFixed()).toBe('45000');
        expect(priceResult.value?.assetSymbol.toString()).toBe('BTC');
        expect(priceResult.value?.currency.toString()).toBe('USD');
        expect(priceResult.value?.source).toBe('manual');
        expect(priceResult.value?.granularity).toBe('exact');
      }
    });

    it('should save a manual price entry with custom currency', async () => {
      const service = new ManualPriceService(testDbPath);

      const result = await service.savePrice({
        assetSymbol: 'BTC',
        date: new Date('2024-01-15T10:30:00Z'),
        price: parseDecimal('42000'),
        currency: 'EUR',
      });

      expect(result.isOk()).toBe(true);

      // Verify the price was saved with EUR currency
      const priceResult = await queries.getPrice(
        'BTC' as Currency,
        'EUR' as Currency,
        new Date('2024-01-15T10:30:00Z')
      );

      expect(priceResult.isOk()).toBe(true);
      if (priceResult.isOk()) {
        expect(priceResult.value).toBeDefined();
        expect(priceResult.value?.currency.toString()).toBe('EUR');
      }
    });

    it('should save a manual price entry with custom source', async () => {
      const service = new ManualPriceService(testDbPath);

      const result = await service.savePrice({
        assetSymbol: 'ETH',
        date: new Date('2024-01-15T10:30:00Z'),
        price: parseDecimal('2500'),
        source: 'manual-cli',
      });

      expect(result.isOk()).toBe(true);

      // Verify the source was saved
      const priceResult = await queries.getPrice(
        'ETH' as Currency,
        'USD' as Currency,
        new Date('2024-01-15T10:30:00Z')
      );

      expect(priceResult.isOk()).toBe(true);
      if (priceResult.isOk()) {
        expect(priceResult.value?.source).toBe('manual-cli');
      }
    });

    it('should handle database errors gracefully', async () => {
      const service = new ManualPriceService('/invalid/path/that/does/not/exist/db.sqlite');

      const result = await service.savePrice({
        assetSymbol: 'BTC',
        date: new Date('2024-01-15T10:30:00Z'),
        price: parseDecimal('45000'),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Should wrap the initialization error
        expect(result.error.message).toMatch(/Failed to (save manual price|create prices database)/);
      }
    });
  });

  describe('saveFxRate', () => {
    it('should save a manual FX rate entry', async () => {
      const service = new ManualPriceService(testDbPath);

      const result = await service.saveFxRate({
        from: 'EUR',
        to: 'USD',
        date: new Date('2024-01-15T00:00:00Z'),
        rate: parseDecimal('1.08'),
      });

      expect(result.isOk()).toBe(true);

      // Verify the FX rate was saved (stored as asset=EUR, currency=USD)
      const rateResult = await queries.getPrice('EUR' as Currency, 'USD' as Currency, new Date('2024-01-15T00:00:00Z'));

      expect(rateResult.isOk()).toBe(true);
      if (rateResult.isOk()) {
        expect(rateResult.value).toBeDefined();
        expect(rateResult.value?.price.toFixed()).toBe('1.08');
        expect(rateResult.value?.assetSymbol.toString()).toBe('EUR');
        expect(rateResult.value?.currency.toString()).toBe('USD');
        expect(rateResult.value?.source).toBe('user-provided');
        expect(rateResult.value?.granularity).toBe('exact');
      }
    });

    it('should save a manual FX rate entry with custom source', async () => {
      const service = new ManualPriceService(testDbPath);

      const result = await service.saveFxRate({
        from: 'CAD',
        to: 'USD',
        date: new Date('2024-06-20T00:00:00Z'),
        rate: parseDecimal('0.73'),
        source: 'bank-statement',
      });

      expect(result.isOk()).toBe(true);

      // Verify the source was saved
      const rateResult = await queries.getPrice('CAD' as Currency, 'USD' as Currency, new Date('2024-06-20T00:00:00Z'));

      expect(rateResult.isOk()).toBe(true);
      if (rateResult.isOk()) {
        expect(rateResult.value?.source).toBe('bank-statement');
      }
    });

    it('should reject FX rate when from and to currencies are the same', async () => {
      const service = new ManualPriceService(testDbPath);

      const result = await service.saveFxRate({
        from: 'USD',
        to: 'USD',
        date: new Date('2024-01-15T00:00:00Z'),
        rate: parseDecimal('1.0'),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Source and target currencies must be different');
      }
    });

    it('should handle database errors gracefully', async () => {
      const service = new ManualPriceService('/invalid/path/that/does/not/exist/db.sqlite');

      const result = await service.saveFxRate({
        from: 'EUR',
        to: 'USD',
        date: new Date('2024-01-15T00:00:00Z'),
        rate: parseDecimal('1.08'),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Should wrap the initialization error
        expect(result.error.message).toMatch(/Failed to (save manual FX rate|create prices database)/);
      }
    });
  });

  describe('multiple calls', () => {
    it('should reuse initialized database connection', async () => {
      const service = new ManualPriceService(testDbPath);

      // First call
      const result1 = await service.savePrice({
        assetSymbol: 'BTC',
        date: new Date('2024-01-15T10:30:00Z'),
        price: parseDecimal('45000'),
      });

      expect(result1.isOk()).toBe(true);

      // Second call should reuse connection
      const result2 = await service.savePrice({
        assetSymbol: 'ETH',
        date: new Date('2024-01-15T10:30:00Z'),
        price: parseDecimal('2500'),
      });

      expect(result2.isOk()).toBe(true);

      // Verify both were saved
      const btcResult = await queries.getPrice('BTC' as Currency, 'USD' as Currency, new Date('2024-01-15T10:30:00Z'));

      const ethResult = await queries.getPrice('ETH' as Currency, 'USD' as Currency, new Date('2024-01-15T10:30:00Z'));

      expect(btcResult.isOk()).toBe(true);
      expect(ethResult.isOk()).toBe(true);
    });
  });
});

describe('Helper functions', () => {
  let db: PricesDB;
  let testDbPath: string;

  beforeEach(async () => {
    // Create a temporary database file path
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-price-helper-test-'));
    testDbPath = path.join(tmpDir, 'test.db');

    // Create database
    const dbResult = createPricesDatabase(testDbPath);
    if (dbResult.isErr()) {
      throw dbResult.error;
    }
    db = dbResult.value;

    // Run migrations
    const migrationResult = await initializePricesDatabase(db);
    if (migrationResult.isErr()) {
      throw migrationResult.error;
    }
  });

  afterEach(async () => {
    await db.destroy();
    // Clean up test database file
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      // Remove the temp directory
      const tmpDir = path.dirname(testDbPath);
      if (fs.existsSync(tmpDir)) {
        fs.rmdirSync(tmpDir);
      }
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('saveManualPrice', () => {
    it('should save price using string value', async () => {
      const result = await saveManualPrice(
        'BTC',
        new Date('2024-01-15T10:30:00Z'),
        '45000',
        'USD',
        'manual',
        testDbPath
      );

      expect(result.isOk()).toBe(true);
    });

    it('should save price using Decimal value', async () => {
      const result = await saveManualPrice(
        'BTC',
        new Date('2024-01-15T10:30:00Z'),
        parseDecimal('45000'),
        'USD',
        'manual',
        testDbPath
      );

      expect(result.isOk()).toBe(true);
    });

    it('should use custom currency and source', async () => {
      const result = await saveManualPrice(
        'BTC',
        new Date('2024-01-15T10:30:00Z'),
        '42000',
        'EUR',
        'manual-cli',
        testDbPath
      );

      expect(result.isOk()).toBe(true);
    });
  });

  describe('saveManualFxRate', () => {
    it('should save FX rate using string value', async () => {
      const result = await saveManualFxRate(
        'EUR',
        'USD',
        new Date('2024-01-15T00:00:00Z'),
        '1.08',
        'user-provided',
        testDbPath
      );

      expect(result.isOk()).toBe(true);
    });

    it('should save FX rate using Decimal value', async () => {
      const result = await saveManualFxRate(
        'EUR',
        'USD',
        new Date('2024-01-15T00:00:00Z'),
        parseDecimal('1.08'),
        'user-provided',
        testDbPath
      );

      expect(result.isOk()).toBe(true);
    });

    it('should use custom source', async () => {
      const result = await saveManualFxRate(
        'CAD',
        'USD',
        new Date('2024-06-20T00:00:00Z'),
        '0.73',
        'bank-statement',
        testDbPath
      );

      expect(result.isOk()).toBe(true);
    });
  });
});

/**
 * Manual price entry service
 *
 * Simple abstraction for saving manual prices and FX rates to the cache.
 * Handles all database initialization internally.
 */

import { type Currency, parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { createPricesDatabase, initializePricesDatabase } from '../persistence/database.js';
import { createPriceQueries, type PriceQueries } from '../persistence/queries/price-queries.js';

/**
 * Manual price entry data
 */
export interface ManualPriceEntry {
  assetSymbol: string;
  date: Date;
  price: Decimal;
  currency?: string | undefined;
  source?: string | undefined;
}

/**
 * Manual FX rate entry data
 */
export interface ManualFxRateEntry {
  from: string;
  to: string;
  date: Date;
  rate: Decimal;
  source?: string | undefined;
}

/**
 * Service for manual price and FX rate entry
 *
 * This service provides a simple API for saving manual prices and FX rates
 * to the price cache. All database management is handled internally.
 */
export class ManualPriceService {
  private queries: PriceQueries | undefined;
  private initialized = false;

  constructor(private readonly databasePath: string) {}

  /**
   * Save a manual price entry to the cache
   *
   * @param entry - Manual price entry data
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * const service = new ManualPriceService('./data/prices.db');
   * const result = await service.savePrice({
   *   assetSymbol: 'BTC',
   *   date: new Date('2024-01-15T10:30:00Z'),
   *   price: parseDecimal('45000'),
   *   currency: 'USD',
   *   source: 'manual-cli'
   * });
   * ```
   */
  async savePrice(entry: ManualPriceEntry): Promise<Result<void, Error>> {
    try {
      // Ensure initialized
      const initResult = await this.ensureInitialized();
      if (initResult.isErr()) {
        return err(initResult.error);
      }

      // Parse currencies
      const asset = entry.assetSymbol as Currency;
      const currency = (entry.currency || 'USD') as Currency;

      // Save to cache
      const saveResult = await this.queries!.savePrice({
        assetSymbol: asset,
        currency,
        timestamp: entry.date,
        price: entry.price,
        source: entry.source || 'manual',
        fetchedAt: new Date(),
        granularity: 'exact',
      });

      return saveResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to save manual price: ${errorMessage}`));
    }
  }

  /**
   * Save a manual FX rate entry to the cache
   *
   * FX rates are stored as prices where asset=sourceCurrency and currency=targetCurrency.
   * This matches how StandardFxRateProvider fetches FX rates.
   *
   * @param entry - Manual FX rate entry data
   * @returns Result indicating success or failure
   *
   * @example
   * ```typescript
   * const service = new ManualPriceService('./data/prices.db');
   * const result = await service.saveFxRate({
   *   from: 'EUR',
   *   to: 'USD',
   *   date: new Date('2024-01-15'),
   *   rate: parseDecimal('1.08'),
   *   source: 'user-provided'
   * });
   * ```
   */
  async saveFxRate(entry: ManualFxRateEntry): Promise<Result<void, Error>> {
    try {
      // Ensure initialized
      const initResult = await this.ensureInitialized();
      if (initResult.isErr()) {
        return err(initResult.error);
      }

      // Parse currencies
      const fromCurrency = entry.from as Currency;
      const toCurrency = entry.to as Currency;

      // Validate currencies are different
      if (fromCurrency === toCurrency) {
        return err(new Error('Source and target currencies must be different'));
      }

      // Save to cache (asset=from, currency=to)
      const saveResult = await this.queries!.savePrice({
        assetSymbol: fromCurrency,
        currency: toCurrency,
        timestamp: entry.date,
        price: entry.rate,
        source: entry.source || 'user-provided',
        fetchedAt: new Date(),
        granularity: 'exact',
      });

      return saveResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to save manual FX rate: ${errorMessage}`));
    }
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<Result<void, Error>> {
    if (this.initialized && this.queries) {
      return ok();
    }

    try {
      // Create database
      const dbResult = createPricesDatabase(this.databasePath);
      if (dbResult.isErr()) {
        return err(new Error(`Failed to create prices database: ${dbResult.error.message}`));
      }

      const db = dbResult.value;

      // Run migrations
      const migrationResult = await initializePricesDatabase(db);
      if (migrationResult.isErr()) {
        return err(new Error(`Failed to initialize database: ${migrationResult.error.message}`));
      }

      // Create queries
      this.queries = createPriceQueries(db);
      this.initialized = true;

      return ok();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to initialize manual price service: ${errorMessage}`));
    }
  }
}

/**
 * Helper function to save a manual price
 *
 * Convenience wrapper that creates a service instance, saves the price, and cleans up.
 *
 * @param assetSymbol - Asset symbol (e.g., 'BTC', 'ETH')
 * @param date - Date/time for the price
 * @param price - Price value as Decimal or string
 * @param currency - Currency code (default: 'USD')
 * @param source - Source attribution (default: 'manual')
 * @param databasePath - Path to the database file
 * @returns Result indicating success or failure
 */
export async function saveManualPrice(
  assetSymbol: string,
  date: Date,
  price: Decimal | string,
  currency = 'USD',
  source = 'manual',
  databasePath: string
): Promise<Result<void, Error>> {
  const service = new ManualPriceService(databasePath);
  return service.savePrice({
    assetSymbol: assetSymbol,
    date,
    price: typeof price === 'string' ? parseDecimal(price) : price,
    currency,
    source,
  });
}

/**
 * Helper function to save a manual FX rate
 *
 * Convenience wrapper that creates a service instance, saves the rate, and cleans up.
 *
 * @param from - Source currency (e.g., 'EUR', 'CAD')
 * @param to - Target currency (e.g., 'USD')
 * @param date - Date/time for the rate
 * @param rate - FX rate value as Decimal or string
 * @param source - Source attribution (default: 'user-provided')
 * @param databasePath - Path to the database file
 * @returns Result indicating success or failure
 */
export async function saveManualFxRate(
  from: string,
  to: string,
  date: Date,
  rate: Decimal | string,
  source = 'user-provided',
  databasePath: string
): Promise<Result<void, Error>> {
  const service = new ManualPriceService(databasePath);
  return service.saveFxRate({
    from,
    to,
    date,
    rate: typeof rate === 'string' ? parseDecimal(rate) : rate,
    source,
  });
}

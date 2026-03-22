/**
 * Manual price entry service
 *
 * Simple abstraction for saving manual prices and FX rates to the cache.
 * Handles all database initialization internally.
 */

import { type Currency, wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

import type { ManualFxRateEntry, ManualPriceEntry } from '../../contracts/manual-prices.js';
import { initPriceCachePersistence, type PriceCachePersistence } from '../persistence/runtime.js';

/**
 * Service for manual price and FX rate entry
 *
 * This service provides a simple API for saving manual prices and FX rates
 * to the price cache. All database management is handled internally.
 */
export class ManualPriceService {
  private initializationPromise: Promise<Result<void, Error>> | undefined;
  private persistence: PriceCachePersistence | undefined;
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
      const initResult = await this.ensureInitialized();
      if (initResult.isErr()) {
        return err(initResult.error);
      }

      const saveResult = await this.persistence!.queries.savePrice({
        assetSymbol: entry.assetSymbol,
        currency: entry.currency ?? ('USD' as Currency),
        timestamp: entry.date,
        price: entry.price,
        source: entry.source || 'manual',
        fetchedAt: new Date(),
        granularity: 'exact',
      });

      return saveResult;
    } catch (error) {
      return wrapError(error, 'Failed to save manual price');
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
      const initResult = await this.ensureInitialized();
      if (initResult.isErr()) {
        return err(initResult.error);
      }

      if (entry.from === entry.to) {
        return err(new Error('Source and target currencies must be different'));
      }

      // FX rates stored as prices: asset=from, currency=to (matches StandardFxRateProvider fetch pattern)
      const saveResult = await this.persistence!.queries.savePrice({
        assetSymbol: entry.from,
        currency: entry.to,
        timestamp: entry.date,
        price: entry.rate,
        source: entry.source || 'user-provided',
        fetchedAt: new Date(),
        granularity: 'exact',
      });

      return saveResult;
    } catch (error) {
      return wrapError(error, 'Failed to save manual FX rate');
    }
  }

  async destroy(): Promise<void> {
    if (!this.persistence) {
      this.initializationPromise = undefined;
      return;
    }

    await this.persistence.cleanup();
    this.persistence = undefined;
    this.initialized = false;
    this.initializationPromise = undefined;
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<Result<void, Error>> {
    if (this.initialized && this.persistence) {
      return ok(undefined);
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.initializePersistence();
    }

    return this.initializationPromise;
  }

  private async initializePersistence(): Promise<Result<void, Error>> {
    try {
      const persistenceResult = await initPriceCachePersistence(this.databasePath);
      if (persistenceResult.isErr()) {
        this.initializationPromise = undefined;
        return wrapError(persistenceResult.error, 'Failed to initialize manual price service');
      }

      this.persistence = persistenceResult.value;
      this.initialized = true;

      return ok(undefined);
    } catch (error) {
      this.initializationPromise = undefined;
      return wrapError(error, 'Failed to initialize manual price service');
    }
  }
}

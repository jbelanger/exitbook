/**
 * Base provider class with common functionality
 *
 */

import { isFiat, type Currency } from '@exitbook/core';
import type { HttpClient } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PriceQueries } from '../persistence/queries/price-queries.js';

import type { IPriceProvider, PriceData, PriceQuery, ProviderMetadata } from './types.js';
import { validatePriceData, validateQueryTimeRange } from './utils.js';

/**
 * Base class providing common provider functionality
 *
 * Subclasses implement the actual fetching logic
 */
export abstract class BasePriceProvider implements IPriceProvider {
  protected abstract metadata: ProviderMetadata;
  protected priceQueries!: PriceQueries; // Set by subclass constructor
  protected httpClient!: HttpClient; // Set by subclass constructor
  protected readonly logger = getLogger('BasePriceProvider');

  /**
   * Subclasses must implement the core fetch logic
   * Query is already validated and currency is normalized at this point
   */
  protected abstract fetchPriceInternal(query: PriceQuery): Promise<Result<PriceData, Error>>;

  /**
   * Public API - validates query, normalizes currency, and delegates to implementation
   */
  async fetchPrice(query: PriceQuery): Promise<Result<PriceData, Error>> {
    // Side effect: get current time
    const now = new Date();

    // Validate time range (pure function - pass now explicitly)
    // Pass isFiat flag to allow historical dates for fiat currencies
    const timeError = validateQueryTimeRange(query.timestamp, now, isFiat(query.assetSymbol));
    if (timeError) {
      return err(new Error(timeError));
    }

    // Normalize assetSymbol and currency to uppercase; default currency to USD
    const normalizedQuery: PriceQuery = {
      ...query,
      assetSymbol: query.assetSymbol.toUpperCase() as Currency,
      currency: (query.currency ?? ('USD' as Currency)).toUpperCase() as Currency,
    };

    // Delegate to implementation
    const result = await this.fetchPriceInternal(normalizedQuery);

    // Validate result data (pure function - pass now explicitly)
    if (result.isOk()) {
      const validationError = validatePriceData(result.value, now);
      if (validationError) {
        return err(new Error(`Invalid price data: ${validationError}`));
      }
    }

    return result;
  }

  /**
   * Get provider metadata
   */
  getMetadata(): ProviderMetadata {
    return this.metadata;
  }

  /**
   * Cleanup resources - close HTTP client
   */
  async destroy(): Promise<void> {
    await this.httpClient.close();
  }

  /**
   * Check cache for price data
   * Shared cache-checking logic used by all providers (addresses recommendation #1)
   */
  protected async checkCache(query: PriceQuery, currency: Currency): Promise<Result<PriceData | undefined, Error>> {
    const cachedResult = await this.priceQueries.getPrice(query.assetSymbol, currency, query.timestamp);

    if (cachedResult.isErr()) {
      return err(cachedResult.error);
    }

    if (cachedResult.value) {
      this.logger.debug(
        { assetSymbol: query.assetSymbol, currency, timestamp: query.timestamp },
        'Price found in cache'
      );
      return ok(cachedResult.value);
    }

    return ok(undefined);
  }

  /**
   * Save price data to cache
   * Shared cache-saving logic used by all providers (addresses recommendation #1)
   */
  protected async saveToCache(priceData: PriceData, identifier: string): Promise<void> {
    // Validate price data before caching to prevent invalid data from being stored
    const validationError = validatePriceData(priceData, new Date());
    if (validationError) {
      this.logger.warn(
        { error: validationError, assetSymbol: priceData.assetSymbol, price: priceData.price.toFixed() },
        'Refusing to cache invalid price data'
      );
      return;
    }

    const cacheResult = await this.priceQueries.savePrice(priceData, identifier);
    if (cacheResult.isErr()) {
      this.logger.warn({ error: cacheResult.error.message }, 'Failed to cache price');
      // Don't fail the request if caching fails
    }
  }
}

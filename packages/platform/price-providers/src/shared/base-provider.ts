/**
 * Base provider class with common functionality
 *
 */

import { Currency } from '@exitbook/core';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PriceRepository } from '../persistence/repositories/price-repository.js';

import { validatePriceData, validateQueryTimeRange } from './shared-utils.ts';
import type { IPriceProvider, PriceData, PriceQuery, ProviderMetadata } from './types/index.js';

/**
 * Base class providing common provider functionality
 *
 * Subclasses implement the actual fetching logic
 */
export abstract class BasePriceProvider implements IPriceProvider {
  protected abstract metadata: ProviderMetadata;
  protected priceRepo!: PriceRepository; // Set by subclass constructor
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
    const timeError = validateQueryTimeRange(query.timestamp, now);
    if (timeError) {
      return err(new Error(timeError));
    }

    // Normalize currency to USD if not specified (addresses recommendation #6)
    const normalizedQuery: PriceQuery = {
      ...query,
      currency: query.currency || Currency.create('USD'),
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
   * Check cache for price data
   * Shared cache-checking logic used by all providers (addresses recommendation #1)
   */
  protected async checkCache(query: PriceQuery, currency: Currency): Promise<Result<PriceData | undefined, Error>> {
    const cachedResult = await this.priceRepo.getPrice(query.asset, currency, query.timestamp);

    if (cachedResult.isErr()) {
      return err(cachedResult.error);
    }

    if (cachedResult.value) {
      this.logger.debug(
        { asset: query.asset.toString(), currency: currency.toString(), timestamp: query.timestamp },
        'Price found in cache'
      );
      return ok(cachedResult.value);
    }

    // eslint-disable-next-line unicorn/no-useless-undefined -- Explicitly return undefined when not found
    return ok(undefined);
  }

  /**
   * Save price data to cache
   * Shared cache-saving logic used by all providers (addresses recommendation #1)
   */
  protected async saveToCache(priceData: PriceData, identifier: string): Promise<void> {
    const cacheResult = await this.priceRepo.savePrice(priceData, identifier);
    if (cacheResult.isErr()) {
      this.logger.warn({ error: cacheResult.error.message }, 'Failed to cache price');
      // Don't fail the request if caching fails
    }
  }
}

/**
 * Base provider class with common functionality
 *
 */

import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { createCacheKey, validatePriceData, validateQueryTimeRange } from './price-utils.js';
import type { IPriceProvider, PriceData, PriceQuery, ProviderMetadata } from './types/index.js';

/**
 * Base class providing common provider functionality
 *
 * Subclasses implement the actual fetching logic
 */
export abstract class BasePriceProvider implements IPriceProvider {
  protected abstract metadata: ProviderMetadata;

  /**
   * Subclasses must implement the core fetch logic
   */
  protected abstract fetchPriceImpl(query: PriceQuery): Promise<Result<PriceData, Error>>;

  /**
   * Public API - validates query and delegates to implementation
   */
  async fetchPrice(query: PriceQuery): Promise<Result<PriceData, Error>> {
    // Side effect: get current time
    const now = new Date();

    // Validate time range (pure function - pass now explicitly)
    const timeError = validateQueryTimeRange(query.timestamp, now);
    if (timeError) {
      return err(new Error(timeError));
    }

    // Delegate to implementation
    const result = await this.fetchPriceImpl(query);

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
   * Default batch implementation - calls fetchPrice for each query
   * Subclasses can override for optimized batch fetching
   */
  async fetchBatch(queries: PriceQuery[]): Promise<Result<PriceData[], Error>> {
    const results = await Promise.allSettled(queries.map((query) => this.fetchPrice(query)));

    const prices: PriceData[] = [];
    const errors: Error[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.isOk()) {
        prices.push(result.value.value);
      } else if (result.status === 'fulfilled' && result.value.isErr()) {
        errors.push(result.value.error);
      } else if (result.status === 'rejected') {
        errors.push(new Error(String(result.reason)));
      }
    }

    // If any query succeeded, return partial results
    if (prices.length > 0) {
      return ok(prices);
    }

    // All failed
    return err(new Error(`All batch queries failed: ${errors.map((e) => e.message).join('; ')}`));
  }

  /**
   * Get provider metadata
   */
  getMetadata(): ProviderMetadata {
    return this.metadata;
  }

  /**
   * Helper to create cache key (delegates to pure function)
   */
  protected createCacheKey(query: PriceQuery): string {
    return createCacheKey(query);
  }
}

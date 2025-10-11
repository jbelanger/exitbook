/**
 * Base provider class with common functionality
 *
 */

import type { Result } from 'neverthrow';
import { err } from 'neverthrow';

import { validatePriceData, validateQueryTimeRange } from './shared-utils.ts';
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
  protected abstract fetchPriceInternal(query: PriceQuery): Promise<Result<PriceData, Error>>;

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
    const result = await this.fetchPriceInternal(query);

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
}

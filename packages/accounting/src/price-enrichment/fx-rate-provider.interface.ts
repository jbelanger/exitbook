/**
 * Interface for fetching FX rates
 *
 * This interface defines what the normalization service needs without
 * coupling it to specific implementations (providers, interactive prompts, etc.).
 *
 * Following Clean Architecture's Dependency Rule:
 * - Inner layer (service) defines the interface
 * - Outer layers (CLI, infrastructure) provide implementations
 */

import type { Currency } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';

/**
 * FX rate data with metadata
 */
export interface FxRateData {
  /** Exchange rate (e.g., 1.08 for EUR→USD) */
  rate: Decimal;

  /** Source of the rate (e.g., 'ecb', 'bank-of-canada', 'user-provided') */
  source: string;

  /** When the rate was fetched or provided */
  fetchedAt: Date;
}

/**
 * Provider for FX rates
 *
 * Implementations might:
 * - Fetch from external APIs (ECB, Bank of Canada)
 * - Prompt user for manual entry (interactive mode)
 * - Use cached rates from database
 * - Combine multiple strategies
 */
export interface IFxRateProvider {
  /**
   * Get FX rate to convert from source currency to USD
   *
   * @param sourceCurrency - Currency to convert from (e.g., EUR, CAD)
   * @param timestamp - Transaction date to get historical rate
   * @returns FX rate data or error
   */
  getRateToUSD(sourceCurrency: Currency, timestamp: Date): Promise<Result<FxRateData, Error>>;
}

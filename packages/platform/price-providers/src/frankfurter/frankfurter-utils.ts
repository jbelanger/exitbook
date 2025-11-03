/**
 * Utility functions for Frankfurter provider
 *
 * Pure functions for transforming Frankfurter API responses
 */

import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PriceData } from '../shared/types/index.js';

import type { FrankfurterSingleDateResponse } from './schemas.js';

/**
 * Format date for Frankfurter API (YYYY-MM-DD)
 */
export function formatFrankfurterDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Transform Frankfurter API response to PriceData
 *
 * Pure function - all inputs explicitly passed
 *
 * @param response - Validated Frankfurter API response
 * @param asset - Source currency (e.g., EUR, CAD, GBP)
 * @param targetCurrency - Target currency (should be USD per our architecture)
 * @param timestamp - Original requested timestamp
 * @param fetchedAt - When the data was fetched
 */
export function transformFrankfurterResponse(
  response: FrankfurterSingleDateResponse,
  asset: Currency,
  targetCurrency: Currency,
  timestamp: Date,
  fetchedAt: Date
): Result<PriceData, Error> {
  // Validate response has rates
  if (!response.rates || Object.keys(response.rates).length === 0) {
    return err(new Error(`No exchange rate data found for ${asset.toString()} on ${response.date}`));
  }

  // Get the rate for our target currency
  const rate = response.rates[targetCurrency.toString()];
  if (rate === undefined) {
    return err(new Error(`No rate found for ${targetCurrency.toString()} in response`));
  }

  if (typeof rate !== 'number' || rate <= 0) {
    return err(new Error(`Invalid exchange rate: ${rate}`));
  }

  return ok({
    asset,
    timestamp,
    price: parseDecimal(rate.toString()),
    currency: targetCurrency,
    source: 'frankfurter',
    fetchedAt,
    granularity: 'day',
  });
}

/**
 * Supported currencies by Frankfurter (ECB reference rates)
 *
 * This is a comprehensive list of fiat currencies supported by Frankfurter.
 * Frankfurter provides rates for all currencies published by the ECB.
 *
 * Note: EUR is special - it's the base currency for ECB data, but Frankfurter
 * can convert from/to any supported currency pair.
 */
export const FRANKFURTER_SUPPORTED_CURRENCIES = [
  'AUD', // Australian Dollar
  'BGN', // Bulgarian Lev
  'BRL', // Brazilian Real
  'CAD', // Canadian Dollar
  'CHF', // Swiss Franc
  'CNY', // Chinese Yuan
  'CZK', // Czech Koruna
  'DKK', // Danish Krone
  'EUR', // Euro
  'GBP', // British Pound
  'HKD', // Hong Kong Dollar
  'HUF', // Hungarian Forint
  'IDR', // Indonesian Rupiah
  'ILS', // Israeli Shekel
  'INR', // Indian Rupee
  'ISK', // Icelandic Krona
  'JPY', // Japanese Yen
  'KRW', // South Korean Won
  'MXN', // Mexican Peso
  'MYR', // Malaysian Ringgit
  'NOK', // Norwegian Krone
  'NZD', // New Zealand Dollar
  'PHP', // Philippine Peso
  'PLN', // Polish Zloty
  'RON', // Romanian Leu
  'SEK', // Swedish Krona
  'SGD', // Singapore Dollar
  'THB', // Thai Baht
  'TRY', // Turkish Lira
  'USD', // US Dollar
  'ZAR', // South African Rand
] as const;

/**
 * Check if a currency is supported by Frankfurter
 */
export function isSupportedCurrency(currency: string): boolean {
  return FRANKFURTER_SUPPORTED_CURRENCIES.includes(currency as (typeof FRANKFURTER_SUPPORTED_CURRENCIES)[number]);
}

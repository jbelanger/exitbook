/**
 * Utility functions for ECB provider
 *
 * Pure functions for transforming ECB API responses
 */

import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PriceData } from '../../core/types.js';

import type { ECBExchangeRateResponse } from './schemas.js';

/**
 * Format date for ECB API (YYYY-MM-DD)
 */
export function formatECBDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Transform ECB API response to PriceData
 *
 * Pure function - all inputs explicitly passed
 */
export function transformECBResponse(
  response: ECBExchangeRateResponse,
  assetSymbol: Currency,
  timestamp: Date,
  currency: Currency,
  fetchedAt: Date
): Result<PriceData, Error> {
  // ECB returns SDMX JSON format with nested structure
  const datasets = response.dataSets;
  if (!datasets || datasets.length === 0) {
    return err(new Error('No datasets in ECB response'));
  }

  const dataset = datasets[0];
  if (!dataset) {
    return err(new Error('Empty dataset in ECB response'));
  }

  // Get first (and typically only) series
  const seriesKeys = Object.keys(dataset.series);
  if (seriesKeys.length === 0) {
    return err(new Error('No series found in ECB response'));
  }

  const seriesKey = seriesKeys[0];
  if (!seriesKey) {
    return err(new Error('Invalid series key'));
  }

  const series = dataset.series[seriesKey];
  if (!series) {
    return err(new Error('Series not found in dataset'));
  }

  // Get observations (time series data)
  const observations = series.observations;
  if (!observations || Object.keys(observations).length === 0) {
    return err(new Error(`No exchange rate data found for ${assetSymbol.toString()} on ${formatECBDate(timestamp)}`));
  }

  // ECB typically returns one observation for a specific date
  // Observations are keyed by index (e.g., "0", "1", etc.)
  const observationKeys = Object.keys(observations);
  const firstKey = observationKeys[0];
  if (!firstKey) {
    return err(new Error('No observation key found'));
  }

  const observation = observations[firstKey];
  if (!observation || !Array.isArray(observation)) {
    return err(new Error('Invalid observation format'));
  }

  const rate = observation[0];
  if (typeof rate !== 'number' || rate <= 0) {
    return err(new Error(`Invalid exchange rate: ${rate}`));
  }

  return ok({
    assetSymbol,
    timestamp,
    price: parseDecimal(rate.toString()),
    currency,
    source: 'ecb',
    fetchedAt,
    granularity: 'day',
  });
}

/**
 * Build ECB API flow reference for a currency pair
 *
 * ECB uses currency codes in their data flow identifiers
 * Example: D.EUR.USD.SP00.A = Daily, EUR, USD, Standard Proprietary, Average
 */
export function buildECBFlowRef(sourceCurrency: string, targetCurrency: string): string {
  return `D.${sourceCurrency}.${targetCurrency}.SP00.A`;
}

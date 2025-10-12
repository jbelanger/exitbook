/**
 * Pure utility functions for CryptoCompare operations
 *
 * Stateless transformations and mappings for CryptoCompare data
 */

import type { Currency } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { validateRawPrice } from '../shared/shared-utils.js';
import type { PriceData } from '../shared/types/index.js';

import type { CryptoCompareHistoricalResponse, CryptoCompareOHLCV, CryptoComparePriceResponse } from './schemas.js';

/**
 * Transform CryptoCompare price response to PriceData
 *
 * Pure function - takes all inputs as parameters
 */
export function transformPriceResponse(
  response: CryptoComparePriceResponse,
  asset: Currency,
  timestamp: Date,
  currency: Currency,
  fetchedAt: Date
): Result<PriceData, Error> {
  const rawPrice = response[currency.toString()];

  // Validate price using shared helper
  const priceResult = validateRawPrice(rawPrice, asset, 'CryptoCompare');
  if (priceResult.isErr()) {
    return err(priceResult.error);
  }

  return ok({
    asset,
    timestamp,
    price: priceResult.value,
    currency,
    source: 'cryptocompare',
    fetchedAt,
    granularity: undefined,
  });
}

/**
 * Find the closest OHLCV data point to the target timestamp
 *
 * Returns the data point with a timestamp closest to (but not after) the target
 */
export function findClosestDataPoint(
  data: CryptoCompareOHLCV[],
  targetTimestamp: number
): CryptoCompareOHLCV | undefined {
  if (data.length === 0) {
    return undefined;
  }

  // Filter to only include data points at or before the target timestamp
  const validPoints = data.filter((point) => point.time <= targetTimestamp);

  if (validPoints.length === 0) {
    return undefined;
  }

  // Find the closest point
  let closest = validPoints[0];
  let minDiff = Math.abs(targetTimestamp - closest!.time);

  for (const point of validPoints) {
    const diff = Math.abs(targetTimestamp - point.time);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }

  return closest;
}

/**
 * Transform CryptoCompare historical response to PriceData
 *
 * Pure function - uses close price from the data point nearest to the timestamp
 */
export function transformHistoricalResponse(
  response: CryptoCompareHistoricalResponse,
  asset: Currency,
  timestamp: Date,
  currency: Currency,
  fetchedAt: Date,
  granularity: 'minute' | 'hour' | 'day'
): Result<PriceData, Error> {
  if (response.Response !== 'Success') {
    return err(new Error(`CryptoCompare API error: ${response.Message || 'Unknown error'}`));
  }

  // Check if Data structure exists
  if (!response.Data || !response.Data.Data || response.Data.Data.length === 0) {
    return err(
      new Error(
        `CryptoCompare has no historical data for ${asset.toString()}. ` +
          `Asset may not be listed on CryptoCompare. ${response.Message ? `Message: ${response.Message}` : ''}`
      )
    );
  }

  const targetTimestamp = Math.floor(timestamp.getTime() / 1000);
  const dataPoint = findClosestDataPoint(response.Data.Data, targetTimestamp);

  if (!dataPoint) {
    return err(
      new Error(`CryptoCompare: no data found for ${asset.toString()} at ${timestamp.toISOString().split('T')[0]}`)
    );
  }

  // Validate close price using shared helper
  const priceResult = validateRawPrice(
    dataPoint.close,
    asset,
    `CryptoCompare at ${timestamp.toISOString().split('T')[0]}`
  );
  if (priceResult.isErr()) {
    return err(priceResult.error);
  }

  // Use close price as the price for this timestamp
  return ok({
    asset,
    timestamp,
    price: priceResult.value,
    currency,
    source: 'cryptocompare',
    fetchedAt,
    granularity,
  });
}

/**
 * Check if timestamp is recent enough for current price API
 * (price/pricemulti only works for current data)
 */
export function canUseCurrentPrice(timestamp: Date): boolean {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffMinutes = diffMs / (1000 * 60);

  // Use current price if within last 5 minutes
  return diffMinutes < 5;
}

/**
 * Determine appropriate historical endpoint based on time range
 *
 * Returns 'minute', 'hour', or 'day' depending on how far back the timestamp is
 */
export function getHistoricalGranularity(timestamp: Date): 'minute' | 'hour' | 'day' {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Use minute data for last 7 days (minute data is available for ~7 days)
  if (diffDays < 7) {
    return 'minute';
  }

  // Use hour data for last 90 days
  if (diffDays < 90) {
    return 'hour';
  }

  // Use day data for older timestamps
  return 'day';
}

/**
 * Build query params for current price request
 */
export function buildPriceParams(asset: Currency, currency: Currency, apiKey?: string): Record<string, string> {
  const params: Record<string, string> = {
    fsym: asset.toString(),
    tsyms: currency.toString(),
  };

  if (apiKey) {
    params.api_key = apiKey;
  }

  return params;
}

/**
 * Build query params for multi-symbol price request
 */
export function buildPriceMultiParams(assets: Currency[], currency: Currency, apiKey?: string): Record<string, string> {
  const params: Record<string, string> = {
    fsyms: assets.map((a) => a.toString()).join(','),
    tsyms: currency.toString(),
  };

  if (apiKey) {
    params.api_key = apiKey;
  }

  return params;
}

/**
 * Build query params for historical data request
 */
export function buildHistoricalParams(
  asset: Currency,
  currency: Currency,
  timestamp: Date,
  apiKey?: string
): Record<string, string> {
  const params: Record<string, string> = {
    fsym: asset.toString(),
    tsym: currency.toString(),
    toTs: Math.floor(timestamp.getTime() / 1000).toString(),
    limit: '1', // Just fetch the specific point
  };

  if (apiKey) {
    params.api_key = apiKey;
  }

  return params;
}

/**
 * Pure utility functions for Binance operations
 *
 * Stateless transformations and mappings for Binance data
 */

import type { Currency } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { roundTimestampByGranularity, validateRawPrice } from '../shared/shared-utils.js';
import type { PriceData, PriceGranularity } from '../shared/types/index.js';

import type { BinanceKline } from './schemas.js';

/**
 * Map currency to Binance quote asset
 *
 * Binance doesn't have direct USD pairs, but uses stablecoins as USD proxies
 * We prioritize USDT (most liquid), then BUSD, then direct fiat currencies
 */
export function mapCurrencyToBinanceQuote(currency: Currency): string[] {
  const currencyStr = currency.toString();

  switch (currencyStr) {
    case 'USD': {
      // Try USDT first (most liquid), then BUSD, then actual USD
      return ['USDT', 'BUSD', 'USD'];
    }
    case 'EUR': {
      return ['EUR'];
    }
    case 'GBP': {
      return ['GBP'];
    }
    default: {
      // For other currencies, use as-is
      return [currencyStr];
    }
  }
}

/**
 * Build Binance symbol from asset and quote currency
 *
 * Binance format: BTCUSDT, ETHUSDT, etc.
 * No separator between base and quote
 */
export function buildBinanceSymbol(asset: Currency, quoteAsset: string): string {
  return `${asset.toString()}${quoteAsset}`;
}

/**
 * Determine which Binance interval to use based on timestamp age
 *
 * Binance provides ~1 year of minute data, then falls back to daily
 */
export function selectBinanceInterval(timestamp: Date): { granularity: PriceGranularity; interval: string } {
  const now = new Date();
  const ageInDays = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24);

  // Use minute data for last 365 days
  if (ageInDays <= 365) {
    return { granularity: 'minute', interval: '1m' };
  }

  // Use daily data for older timestamps
  return { granularity: 'day', interval: '1d' };
}

/**
 * Extract close price from Binance kline
 *
 * We use close price for consistency with other providers
 * Close price is at index 4 in the kline tuple
 */
export function extractClosePriceFromKline(kline: BinanceKline): number {
  const closePrice = kline[4]; // Close price (string)
  return Number.parseFloat(closePrice);
}

/**
 * Transform Binance kline response to PriceData
 *
 * Pure function - takes all inputs as parameters
 */
export function transformBinanceKlineResponse(
  kline: BinanceKline,
  asset: Currency,
  requestedTimestamp: Date,
  currency: Currency,
  fetchedAt: Date,
  granularity: PriceGranularity
): Result<PriceData, Error> {
  // Extract close price
  const rawPrice = extractClosePriceFromKline(kline);

  // Validate price using shared helper
  const priceResult = validateRawPrice(rawPrice, asset, 'Binance');
  if (priceResult.isErr()) {
    return err(priceResult.error);
  }

  // Round timestamp to granularity bucket
  const roundedTimestamp = roundTimestampByGranularity(requestedTimestamp, granularity);

  return ok({
    asset,
    timestamp: roundedTimestamp,
    price: priceResult.value,
    currency,
    source: 'binance',
    fetchedAt,
    granularity,
  });
}

/**
 * Build query params for Binance klines request
 *
 * @param symbol - Binance symbol (e.g., 'BTCUSDT')
 * @param interval - Interval (e.g., '1m', '1d')
 * @param timestamp - Target timestamp
 * @returns Query params for Binance API
 */
export function buildBinanceKlinesParams(symbol: string, interval: string, timestamp: Date): Record<string, string> {
  // Binance expects timestamps in milliseconds
  let startTime = timestamp.getTime();

  // For minute-level data, ensure we're not requesting an incomplete candle
  // Binance may not have data for the current/most recent minute since it's still in progress
  // If the timestamp is within the last 2 minutes, go back to ensure a completed candle
  if (interval === '1m') {
    const now = Date.now();
    const twoMinutesAgo = now - 2 * 60 * 1000;

    if (startTime > twoMinutesAgo) {
      startTime = twoMinutesAgo;
    }
  }

  return {
    symbol,
    interval,
    startTime: startTime.toString(),
    limit: '1', // Just fetch the specific point
  };
}

/**
 * Check if Binance error indicates coin not found
 *
 * Binance error code -1121 means "Invalid symbol"
 */
export function isBinanceCoinNotFoundError(errorCode: number): boolean {
  return errorCode === -1121;
}

/**
 * Check if Binance error indicates rate limit exceeded
 *
 * Binance uses HTTP 429 and error code -1003
 */
export function isBinanceRateLimitError(errorCode: number): boolean {
  return errorCode === -1003;
}

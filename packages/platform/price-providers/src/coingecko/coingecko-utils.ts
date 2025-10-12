/**
 * Pure utility functions for CoinGecko operations
 *
 * Stateless transformations and mappings for CoinGecko data
 */

import { Currency } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { validateRawPrice } from '../shared/shared-utils.js';
import type { PriceData } from '../shared/types/index.js';

import type {
  CoinGeckoCoinListItem,
  CoinGeckoHistoricalPriceResponse,
  CoinGeckoSimplePriceResponse,
} from './schemas.js';

/**
 * Build a symbol -> coin ID map from CoinGecko's coin list
 *
 * Pure function - takes coin list, returns lookup map
 */
export function buildSymbolToCoinIdMap(coinList: CoinGeckoCoinListItem[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const coin of coinList) {
    const symbol = Currency.create(coin.symbol).toString();

    // If symbol already exists, prefer coins with shorter/simpler IDs
    // (usually the more popular coin)
    if (map.has(symbol)) {
      const existing = map.get(symbol)!;
      if (coin.id.length < existing.length) {
        map.set(symbol, coin.id);
      }
    } else {
      map.set(symbol, coin.id);
    }
  }

  return map;
}

/**
 * Format date for CoinGecko API (DD-MM-YYYY format)
 */
export function formatCoinGeckoDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();

  return `${day}-${month}-${year}`;
}

/**
 * Transform CoinGecko historical response to PriceData
 *
 * Pure function - takes all inputs as parameters
 */
export function transformHistoricalResponse(
  response: CoinGeckoHistoricalPriceResponse,
  asset: Currency,
  timestamp: Date,
  currency: Currency,
  fetchedAt: Date
): Result<PriceData, Error> {
  const rawPrice = response.market_data.current_price[currency.toLowerCase()];

  // Validate price using shared helper
  const context = `CoinGecko (coin: ${response.id}) on ${timestamp.toISOString().split('T')[0]}`;
  const priceResult = validateRawPrice(rawPrice, asset, context);
  if (priceResult.isErr()) {
    return err(priceResult.error);
  }

  return ok({
    asset: asset,
    timestamp,
    price: priceResult.value,
    currency: currency,
    source: 'coingecko',
    fetchedAt,
    granularity: 'day',
  });
}

/**
 * Transform CoinGecko simple price response to PriceData
 *
 * Pure function - takes all inputs as parameters
 */
export function transformSimplePriceResponse(
  response: CoinGeckoSimplePriceResponse,
  coinId: string,
  asset: Currency,
  timestamp: Date,
  currency: Currency,
  fetchedAt: Date
): Result<PriceData, Error> {
  const coinData = response[coinId];
  if (!coinData) {
    return err(new Error(`Coin ID ${coinId} for asset ${asset.toString()} not found in response`));
  }

  const rawPrice = coinData[currency.toLowerCase()];

  // Validate price using shared helper
  const context = `CoinGecko (coin: ${coinId})`;
  const priceResult = validateRawPrice(rawPrice, asset, context);
  if (priceResult.isErr()) {
    return err(priceResult.error);
  }

  return ok({
    asset: asset,
    timestamp,
    price: priceResult.value,
    currency: currency,
    source: 'coingecko',
    fetchedAt,
    granularity: undefined,
  });
}

/**
 * Check if date is recent enough for simple price API
 * (simple price only works for current/very recent data)
 */
export function canUseSimplePrice(timestamp: Date): boolean {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  // Use simple price if within last 24 hours
  return diffHours < 24;
}

/**
 * Build query params for batch simple price request
 */
export function buildBatchSimplePriceParams(coinIds: string[], currency: Currency): Record<string, string> {
  return {
    ids: coinIds.join(','),
    vs_currencies: currency.toLowerCase(),
  };
}

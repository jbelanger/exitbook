/**
 * Pure utility functions for CoinGecko operations
 *
 * Stateless transformations and mappings for CoinGecko data
 */

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
    const symbol = coin.symbol.toUpperCase();

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
  asset: string,
  timestamp: Date,
  currency: string,
  fetchedAt: Date
): PriceData {
  const currencyLower = currency.toLowerCase();
  const price = response.market_data.current_price[currencyLower];

  if (price === undefined) {
    throw new Error(`Currency ${currency} not found in response`);
  }

  return {
    asset: asset.toUpperCase(),
    timestamp,
    price,
    currency: currency.toUpperCase(),
    source: 'coingecko',
    fetchedAt,
  };
}

/**
 * Transform CoinGecko simple price response to PriceData
 *
 * Pure function - takes all inputs as parameters
 */
export function transformSimplePriceResponse(
  response: CoinGeckoSimplePriceResponse,
  coinId: string,
  asset: string,
  timestamp: Date,
  currency: string,
  fetchedAt: Date
): PriceData {
  const currencyLower = currency.toLowerCase();

  const coinData = response[coinId];
  if (!coinData) {
    throw new Error(`Coin ID ${coinId} for asset ${asset} not found in response`);
  }

  const price = coinData[currencyLower];
  if (price === undefined) {
    throw new Error(`Currency ${currency} not found for ${asset}`);
  }

  return {
    asset: asset.toUpperCase(),
    timestamp,
    price,
    currency: currency.toUpperCase(),
    source: 'coingecko',
    fetchedAt,
  };
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
export function buildBatchSimplePriceParams(coinIds: string[], currency: string): Record<string, string> {
  return {
    ids: coinIds.join(','),
    vs_currencies: currency.toLowerCase(),
  };
}

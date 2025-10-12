/**
 * Zod schemas for Binance API responses
 */

import { z } from 'zod';

/**
 * Binance Kline (candlestick) data
 * Endpoint: /api/v3/klines
 *
 * Response format:
 * [
 *   [
 *     1499040000000,      // Open time
 *     "0.01634000",       // Open
 *     "0.80000000",       // High
 *     "0.01575800",       // Low
 *     "0.01577100",       // Close
 *     "148976.11427815",  // Volume
 *     1499644799999,      // Close time
 *     "2434.19055334",    // Quote asset volume
 *     308,                // Number of trades
 *     "1756.87402397",    // Taker buy base asset volume
 *     "28.46694368",      // Taker buy quote asset volume
 *     "0"                 // Ignore
 *   ]
 * ]
 */
export const BinanceKlineSchema = z.tuple([
  z.number(), // Open time (Unix timestamp in ms)
  z.string(), // Open price
  z.string(), // High price
  z.string(), // Low price
  z.string(), // Close price
  z.string(), // Volume
  z.number(), // Close time (Unix timestamp in ms)
  z.string(), // Quote asset volume
  z.number(), // Number of trades
  z.string(), // Taker buy base asset volume
  z.string(), // Taker buy quote asset volume
  z.string(), // Unused field (always "0")
]);

export type BinanceKline = z.infer<typeof BinanceKlineSchema>;

/**
 * Binance Klines response (array of klines)
 */
export const BinanceKlinesResponseSchema = z.array(BinanceKlineSchema);

export type BinanceKlinesResponse = z.infer<typeof BinanceKlinesResponseSchema>;

/**
 * Binance error response
 * Binance returns error in this format when request fails
 */
export const BinanceErrorResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
});

export type BinanceErrorResponse = z.infer<typeof BinanceErrorResponseSchema>;

/**
 * Binance Exchange Info Symbol (for symbol validation)
 * Endpoint: /api/v3/exchangeInfo
 */
export const BinanceExchangeInfoSymbolSchema = z.object({
  symbol: z.string(),
  status: z.string(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
});

export type BinanceExchangeInfoSymbol = z.infer<typeof BinanceExchangeInfoSymbolSchema>;

/**
 * Binance Exchange Info response
 */
export const BinanceExchangeInfoResponseSchema = z.object({
  symbols: z.array(BinanceExchangeInfoSymbolSchema),
});

export type BinanceExchangeInfoResponse = z.infer<typeof BinanceExchangeInfoResponseSchema>;

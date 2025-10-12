/**
 * Zod schemas for CryptoCompare API responses
 */

import { z } from 'zod';

/**
 * CryptoCompare OHLCV data point (from histominute/histohour/histoday)
 */
export const CryptoCompareOHLCVSchema = z.object({
  time: z.number(), // Unix timestamp
  high: z.number(),
  low: z.number(),
  open: z.number(),
  close: z.number(),
  volumefrom: z.number(),
  volumeto: z.number(),
  conversionType: z.string(),
  conversionSymbol: z.string(),
});

export type CryptoCompareOHLCV = z.infer<typeof CryptoCompareOHLCVSchema>;

/**
 * CryptoCompare historical data response
 * Endpoint: /data/v2/histominute, /data/v2/histohour, /data/v2/histoday
 */
export const CryptoCompareHistoricalResponseSchema = z.object({
  Response: z.string(),
  Message: z.string().optional(),
  HasWarning: z.boolean(),
  Type: z.number(),
  RateLimit: z.object({}).passthrough().optional(),
  Data: z
    .object({
      Aggregated: z.boolean().optional(),
      TimeFrom: z.number().optional(),
      TimeTo: z.number().optional(),
      Data: z.array(CryptoCompareOHLCVSchema).optional(),
    })
    .optional(),
});

export type CryptoCompareHistoricalResponse = z.infer<typeof CryptoCompareHistoricalResponseSchema>;

/**
 * CryptoCompare single price response (current price)
 * Endpoint: /data/price
 */
export const CryptoComparePriceResponseSchema = z.record(z.number());

export type CryptoComparePriceResponse = z.infer<typeof CryptoComparePriceResponseSchema>;

/**
 * CryptoCompare error response
 */
export const CryptoCompareErrorResponseSchema = z.object({
  Response: z.literal('Error'),
  Message: z.string(),
  HasWarning: z.boolean().optional(),
  Type: z.number().optional(),
  RateLimit: z.object({}).passthrough().optional(),
  Data: z.object({}).optional(),
});

export type CryptoCompareErrorResponse = z.infer<typeof CryptoCompareErrorResponseSchema>;

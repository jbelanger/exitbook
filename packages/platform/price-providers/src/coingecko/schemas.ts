/**
 * Zod schemas for CoinGecko API responses
 */

import { z } from 'zod';

/**
 * CoinGecko coin list item
 * Endpoint: /coins/list
 */
export const CoinGeckoCoinListItemSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
});

export type CoinGeckoCoinListItem = z.infer<typeof CoinGeckoCoinListItemSchema>;

export const CoinGeckoCoinListSchema = z.array(CoinGeckoCoinListItemSchema);

/**
 * CoinGecko markets response (sorted by market cap)
 * Endpoint: /coins/markets
 */
export const CoinGeckoMarketItemSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  market_cap_rank: z
    .number()
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
  market_cap: z
    .number()
    .nullable()
    .optional()
    .transform((val) => val ?? undefined),
});

export type CoinGeckoMarketItem = z.infer<typeof CoinGeckoMarketItemSchema>;

export const CoinGeckoMarketsSchema = z.array(CoinGeckoMarketItemSchema);

/**
 * CoinGecko historical price response
 * Endpoint: /coins/{id}/history
 */
export const CoinGeckoHistoricalPriceResponseSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  market_data: z.object({
    current_price: z.record(z.string(), z.number()),
  }),
});

export type CoinGeckoHistoricalPriceResponse = z.infer<typeof CoinGeckoHistoricalPriceResponseSchema>;

/**
 * CoinGecko simple price response
 * Endpoint: /simple/price
 */
export const CoinGeckoSimplePriceResponseSchema = z.record(z.string(), z.record(z.string(), z.number()));

export type CoinGeckoSimplePriceResponse = z.infer<typeof CoinGeckoSimplePriceResponseSchema>;

/**
 * CoinGecko error response
 */
export const CoinGeckoErrorResponseSchema = z.object({
  error: z.string(),
  status: z
    .object({
      error_code: z.number().optional(),
      error_message: z.string().optional(),
    })
    .optional(),
});

export type CoinGeckoErrorResponse = z.infer<typeof CoinGeckoErrorResponseSchema>;

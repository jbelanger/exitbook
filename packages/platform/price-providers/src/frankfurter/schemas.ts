/**
 * Zod schemas for Frankfurter API responses
 *
 * API Documentation: https://www.frankfurter.app/docs/
 */

import { z } from 'zod';

/**
 * Frankfurter Single Date Exchange Rate Response Schema
 *
 * Example response from Frankfurter API:
 * https://api.frankfurter.dev/2020-06-30?from=USD&to=EUR,JPY,CAD
 *
 * {
 *   "amount": 1.0,
 *   "base": "USD",
 *   "date": "2020-06-30",
 *   "rates": {
 *     "CAD": 1.3587,
 *     "EUR": 0.89305,
 *     "JPY": 107.56
 *   }
 * }
 */
export const FrankfurterSingleDateResponseSchema = z.object({
  amount: z.number(),
  base: z.string(),
  date: z.string(), // YYYY-MM-DD format
  rates: z.record(z.string(), z.number()),
});

export type FrankfurterSingleDateResponse = z.infer<typeof FrankfurterSingleDateResponseSchema>;

/**
 * Frankfurter Time Series Exchange Rate Response Schema
 *
 * Example response from Frankfurter API:
 * https://api.frankfurter.dev/2020-01-01..2020-12-31?from=USD&to=EUR,JPY
 *
 * {
 *   "amount": 1.0,
 *   "base": "USD",
 *   "start_date": "2020-01-01",
 *   "end_date": "2020-12-31",
 *   "rates": {
 *     "2020-01-01": { "EUR": 0.89305, "JPY": 107.56 },
 *     "2020-01-02": { "EUR": 0.89405, "JPY": 107.66 }
 *   }
 * }
 */
export const FrankfurterTimeSeriesResponseSchema = z.object({
  amount: z.number(),
  base: z.string(),
  start_date: z.string(), // YYYY-MM-DD format
  end_date: z.string(), // YYYY-MM-DD format
  rates: z.record(z.string(), z.record(z.string(), z.number())),
});

export type FrankfurterTimeSeriesResponse = z.infer<typeof FrankfurterTimeSeriesResponseSchema>;

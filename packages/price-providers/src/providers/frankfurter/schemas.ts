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

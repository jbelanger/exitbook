/**
 * Zod schemas for Bank of Canada Valet API responses
 *
 * API Documentation: https://www.bankofcanada.ca/valet/docs
 */

import { z } from 'zod';

/**
 * Bank of Canada Valet API Observation Schema
 *
 * Example response structure from Valet API:
 * https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2024-01-01&end_date=2024-01-01
 *
 * Response contains observations for the requested date range
 */
export const BankOfCanadaObservationSchema = z.object({
  d: z.string(), // Date in YYYY-MM-DD format
  FXUSDCAD: z.object({
    v: z.string(), // Rate value as string
  }),
});

export const BankOfCanadaResponseSchema = z.object({
  observations: z.array(BankOfCanadaObservationSchema),
});

export type BankOfCanadaResponse = z.infer<typeof BankOfCanadaResponseSchema>;

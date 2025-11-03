/**
 * Zod schemas for European Central Bank (ECB) API responses
 *
 * API Documentation: https://data.ecb.europa.eu/help/api/overview
 * Data Flow API: https://data.ecb.europa.eu/help/api/data
 */

import { z } from 'zod';

/**
 * ECB Exchange Rate API Response Schema
 *
 * Example response structure from ECB Data Portal API:
 * https://data-api.ecb.europa.eu/service/data/EXR/D.EUR.USD.SP00.A
 *
 * Response format is SDMX JSON (Statistical Data and Metadata eXchange)
 */
export const ECBExchangeRateResponseSchema = z.object({
  dataSets: z.array(
    z.object({
      series: z.record(
        z.string(),
        z.object({
          observations: z.record(z.string(), z.tuple([z.number()])),
        })
      ),
    })
  ),
  structure: z.object({
    dimensions: z.object({
      observation: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          values: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
            })
          ),
        })
      ),
    }),
  }),
});

export type ECBExchangeRateResponse = z.infer<typeof ECBExchangeRateResponseSchema>;

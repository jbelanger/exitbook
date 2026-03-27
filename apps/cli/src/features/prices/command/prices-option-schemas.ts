import { z } from 'zod';

export const PricesViewCommandOptionsSchema = z.object({
  platform: z.string().optional(),
  asset: z.string().optional(),
  missingOnly: z.boolean().optional(),
  json: z.boolean().optional(),
});

export const PricesEnrichCommandOptionsSchema = z.object({
  asset: z.array(z.string()).optional(),
  onMissing: z.enum(['fail']).optional(),
  deriveOnly: z.boolean().optional(),
  normalizeOnly: z.boolean().optional(),
  fetchOnly: z.boolean().optional(),
  json: z.boolean().optional(),
});

export const PricesSetCommandOptionsSchema = z.object({
  asset: z.string(),
  date: z.string(),
  price: z.string(),
  currency: z.string().optional(),
  source: z.string().optional(),
  json: z.boolean().optional(),
});

export const PricesSetFxCommandOptionsSchema = z.object({
  from: z.string(),
  to: z.string(),
  date: z.string(),
  rate: z.string(),
  source: z.string().optional(),
  json: z.boolean().optional(),
});

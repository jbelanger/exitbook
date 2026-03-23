import { z } from 'zod';

export const ProvidersViewCommandOptionsSchema = z.object({
  blockchain: z.string().optional(),
  health: z.enum(['healthy', 'degraded', 'unhealthy']).optional(),
  missingApiKey: z.boolean().optional(),
  json: z.boolean().optional(),
});

export const ProvidersBenchmarkCommandOptionsSchema = z.object({
  blockchain: z.string(),
  provider: z.string(),
  maxRate: z.string().optional(),
  rates: z.string().optional(),
  numRequests: z.string().optional(),
  skipBurst: z.boolean().optional(),
  json: z.boolean().optional(),
});

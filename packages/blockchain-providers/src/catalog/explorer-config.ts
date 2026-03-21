import { z } from 'zod';

const ProviderOverrideSchema = z.object({
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().optional(),
  rateLimit: z
    .object({
      requestsPerSecond: z.number().optional(),
      requestsPerMinute: z.number().optional(),
      requestsPerHour: z.number().optional(),
      burstLimit: z.number().optional(),
    })
    .optional(),
  retries: z.number().optional(),
  timeout: z.number().optional(),
});

const BlockchainConfigSchema = z.object({
  defaultEnabled: z.array(z.string()).optional(),
  overrides: z.record(z.string(), ProviderOverrideSchema).optional(),
});

export const BlockchainExplorersConfigSchema = z.record(z.string(), BlockchainConfigSchema);

export type ProviderOverride = z.infer<typeof ProviderOverrideSchema>;
export type BlockchainExplorersConfig = z.infer<typeof BlockchainExplorersConfigSchema>;

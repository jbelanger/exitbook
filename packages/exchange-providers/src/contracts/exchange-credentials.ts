import { z } from 'zod';

/**
 * Exchange credentials schema - generic key-value pairs validated per exchange.
 */
export const ExchangeCredentialsSchema = z
  .object({
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
    apiPassphrase: z.string().optional(),
  })
  .strict();

export type ExchangeCredentials = z.infer<typeof ExchangeCredentialsSchema>;

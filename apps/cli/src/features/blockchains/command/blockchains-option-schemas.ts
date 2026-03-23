import { z } from 'zod';

export const BlockchainsViewCommandOptionsSchema = z.object({
  category: z.string().optional(),
  requiresApiKey: z.boolean().optional(),
  json: z.boolean().optional(),
});

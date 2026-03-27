import { z } from 'zod';

export const ClearCommandOptionsSchema = z.object({
  accountId: z.number().int().positive().optional(),
  platform: z.string().optional(),
  includeRaw: z.boolean().optional(),
  confirm: z.boolean().optional(),
  json: z.boolean().optional(),
});

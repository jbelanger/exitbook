import { z } from 'zod';

export const AccountsViewCommandOptionsSchema = z.object({
  accountId: z.number().int().positive().optional(),
  source: z.string().optional(),
  type: z.string().optional(),
  showSessions: z.boolean().optional(),
  json: z.boolean().optional(),
});

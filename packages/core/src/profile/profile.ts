import { z } from 'zod';

export const DEFAULT_PROFILE_NAME = 'default';

/**
 * Profile schema - represents a local dataset owner tracking accounts
 */
export const ProfileSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  createdAt: z.date(),
});

/**
 * Type exports inferred from schemas
 */
export type Profile = z.infer<typeof ProfileSchema>;

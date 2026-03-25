import { z } from 'zod';

/**
 * Profile schema - represents a local dataset owner tracking accounts
 */
export const ProfileSchema = z.object({
  id: z.number(),
  createdAt: z.date(),
});

/**
 * Type exports inferred from schemas
 */
export type Profile = z.infer<typeof ProfileSchema>;

import { z } from 'zod';

/**
 * User schema - represents a user tracking accounts
 */
export const UserSchema = z.object({
  id: z.number(),
  createdAt: z.date(),
});

/**
 * Type exports inferred from schemas
 */
export type User = z.infer<typeof UserSchema>;

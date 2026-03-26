import { err, ok, type Result } from '@exitbook/foundation';
import { z } from 'zod';

export const DEFAULT_PROFILE_KEY = 'default';

/**
 * Profile schema - represents a local dataset owner tracking accounts.
 *
 * `displayName` is the mutable command-facing label. `profileKey` is the stable
 * identity anchor used for deterministic fingerprints and rebuilds.
 */
export const ProfileSchema = z.object({
  id: z.number(),
  profileKey: z.string().min(1),
  displayName: z.string().min(1),
  createdAt: z.date(),
});

export function normalizeProfileDisplayName(displayName: string): Result<string, Error> {
  const normalized = displayName.trim();
  if (normalized.length === 0) {
    return err(new Error('Profile display name must not be empty'));
  }

  return ok(normalized);
}

export function normalizeProfileKey(key: string): Result<string, Error> {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (normalized.length === 0) {
    return err(new Error('Profile key must not be empty'));
  }

  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return err(new Error('Profile key may only contain lowercase letters, numbers, and hyphens'));
  }

  return ok(normalized);
}

/**
 * Type exports inferred from schemas
 */
export type Profile = z.infer<typeof ProfileSchema>;

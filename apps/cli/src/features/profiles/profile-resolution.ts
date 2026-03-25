import { DEFAULT_PROFILE_NAME, type Profile } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../runtime/command-runtime.js';

function normalizeRequestedProfileName(name: string): Result<string, Error> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error('Profile name must not be empty'));
  }

  return ok(normalized);
}

export async function resolveCommandProfile(
  ctx: CommandRuntime,
  db: DataSession,
  profileOverride?: string  
): Promise<Result<Profile, Error>> {
  const requestedNameResult = normalizeRequestedProfileName(profileOverride ?? ctx.activeProfileName);
  if (requestedNameResult.isErr()) {
    return err(requestedNameResult.error);
  }

  const requestedName = requestedNameResult.value;
  if (requestedName === DEFAULT_PROFILE_NAME) {
    return db.profiles.findOrCreateDefault();
  }

  const profileResult = await db.profiles.findByName(requestedName);
  if (profileResult.isErr()) {
    return err(profileResult.error);
  }

  if (!profileResult.value) {
    return err(new Error(`Profile '${requestedName}' not found`));
  }

  return ok(profileResult.value);
}

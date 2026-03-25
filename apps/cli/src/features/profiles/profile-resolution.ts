import type { Profile } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import type { Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../runtime/command-runtime.js';

import { buildCliProfileService } from './profile-service.js';

export async function resolveCommandProfile(
  ctx: CommandRuntime,
  db: DataSession,
  profileOverride?: string  
): Promise<Result<Profile, Error>> {
  const profileService = buildCliProfileService(db);
  return profileService.resolve(profileOverride ?? ctx.activeProfileName);
}

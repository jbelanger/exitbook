import type { Profile } from '@exitbook/core';
import { err, wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { createClearHandler, type ClearHandler } from './clear-handler.js';

export interface ClearCommandScope {
  handler: ClearHandler;
  profile: Profile;
}

export async function withClearCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: ClearCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  try {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }

    return operation({
      handler: createClearHandler({ db: database }),
      profile: profileResult.value,
    });
  } catch (error) {
    return wrapError(error, 'Failed to prepare clear command scope');
  }
}

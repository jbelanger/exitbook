import type { Profile } from '@exitbook/core';
import { OverrideStore } from '@exitbook/data/overrides';
import { err, wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { AssetsHandler } from './assets-handler.js';

export interface AssetsCommandScope {
  handler: AssetsHandler;
  profile: Profile;
}

export async function withAssetsCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: AssetsCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  try {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }

    return operation({
      handler: new AssetsHandler(database, new OverrideStore(runtime.dataDir), runtime.dataDir),
      profile: profileResult.value,
    });
  } catch (error) {
    return wrapError(error, 'Failed to prepare assets command scope');
  }
}

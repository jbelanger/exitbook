import type { AccountLifecycleService } from '@exitbook/accounts';
import type { Profile } from '@exitbook/core';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { createCliAccountLifecycleService } from '../../accounts/account-service.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { ClearService } from './clear-service.js';

export interface ClearCommandScope {
  accountService: AccountLifecycleService;
  clearService: ClearService;
  profile: Profile;
}

export async function withClearCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: ClearCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const value = yield* await operation({
      accountService: createCliAccountLifecycleService(database),
      clearService: new ClearService(database),
      profile: profileResult.value,
    });
    return value;
  }, 'Failed to prepare clear command scope');
}

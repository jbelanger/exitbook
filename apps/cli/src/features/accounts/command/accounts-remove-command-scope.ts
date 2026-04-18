import type { Profile } from '@exitbook/core';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { createCliAccountLifecycleService } from '../account-service.js';

import { AccountRemovalService } from './account-removal-service.js';

export interface AccountsRemoveCommandScope {
  accountService: ReturnType<typeof createCliAccountLifecycleService>;
  accountRemovalService: AccountRemovalService;
  profile: Profile;
}

export async function withAccountsRemoveCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: AccountsRemoveCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const value = yield* await operation({
      accountService: createCliAccountLifecycleService(database),
      accountRemovalService: new AccountRemovalService(database, profileResult.value.id),
      profile: profileResult.value,
    });
    return value;
  }, 'Failed to prepare accounts remove command scope');
}

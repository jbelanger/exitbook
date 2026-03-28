import type { Profile } from '@exitbook/core';
import { err, wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { buildCliAccountLifecycleService } from '../account-service.js';

import { createAccountRemoveHandler, type AccountRemoveHandler } from './accounts-remove-handler.js';

export interface AccountsRemoveCommandScope {
  accountService: ReturnType<typeof buildCliAccountLifecycleService>;
  handler: AccountRemoveHandler;
  profile: Profile;
}

export async function withAccountsRemoveCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: AccountsRemoveCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  try {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }

    return operation({
      accountService: buildCliAccountLifecycleService(database),
      handler: createAccountRemoveHandler(database),
      profile: profileResult.value,
    });
  } catch (error) {
    return wrapError(error, 'Failed to prepare accounts remove command scope');
  }
}

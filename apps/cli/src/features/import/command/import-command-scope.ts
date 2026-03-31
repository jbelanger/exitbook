import type { Profile } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

export interface ImportCommandScope {
  database: DataSession;
  profile: Profile;
  registry: AdapterRegistry;
  runtime: CommandRuntime;
}

export async function withImportCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: ImportCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const value = yield* await operation({
      database,
      profile: profileResult.value,
      registry: runtime.requireAppRuntime().adapterRegistry,
      runtime,
    });
    return value;
  }, 'Failed to prepare import command scope');
}

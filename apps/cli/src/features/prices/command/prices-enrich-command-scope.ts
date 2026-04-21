import type { Profile } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import { loadAccountingExclusionPolicy } from '../../../runtime/accounting-exclusion-policy.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

export interface PricesEnrichCommandScope {
  accountingExclusionPolicy: Awaited<ReturnType<typeof loadAccountingExclusionPolicy>> extends Result<infer T, Error>
    ? T
    : never;
  database: DataSession;
  profile: Profile;
  runtime: CommandRuntime;
}

export async function withPricesEnrichCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: PricesEnrichCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.openDatabaseSession();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(
      runtime.dataDir,
      profileResult.value.profileKey
    );
    if (accountingExclusionPolicyResult.isErr()) {
      return yield* err(accountingExclusionPolicyResult.error);
    }

    const value = yield* await operation({
      accountingExclusionPolicy: accountingExclusionPolicyResult.value,
      database,
      profile: profileResult.value,
      runtime,
    });
    return value;
  }, 'Failed to prepare prices enrich command scope');
}

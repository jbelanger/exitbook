import type { AccountLifecycleService } from '@exitbook/accounts';
import type { Profile } from '@exitbook/core';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import type { CliOutputFormat } from '../../../cli/options.js';
import { createCliCommandResourceFactories } from '../../../runtime/command-capability-factories.js';
import { type CommandRuntime } from '../../../runtime/command-runtime.js';
import { ensureProcessedTransactionsReady } from '../../../runtime/projection-readiness.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { createCliAccountLifecycleService } from '../account-service.js';

import { AccountBalanceDetailBuilder } from './account-balance-detail-builder.js';
import { AccountsRefreshRunner } from './accounts-refresh-runner.js';

export interface AccountsRefreshScope {
  accountService: AccountLifecycleService;
  profile: Profile;
  refreshRunner: AccountsRefreshRunner;
}

export async function withAccountsRefreshScope<T>(
  runtime: CommandRuntime,
  options: {
    format: CliOutputFormat;
    needsWorkflow: boolean;
  },
  operation: (scope: AccountsRefreshScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.openDatabaseSession();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const readyResult = await ensureProcessedTransactionsReady(runtime, {
      format: options.format,
      profileId: profileResult.value.id,
    });
    if (readyResult.isErr()) {
      return yield* err(readyResult.error);
    }

    const accountService = createCliAccountLifecycleService(database);
    const detailBuilder = new AccountBalanceDetailBuilder(database);
    const capabilityFactories = createCliCommandResourceFactories(runtime, database);

    if (!options.needsWorkflow) {
      const value = yield* await operation({
        accountService,
        profile: profileResult.value,
        refreshRunner: new AccountsRefreshRunner({
          accountService,
          detailBuilder,
          balanceWorkflow: undefined,
        }),
      });
      return value;
    }

    const balanceWorkflow = await capabilityFactories.balanceWorkflowFactory.getOrCreate();
    const refreshRunner = new AccountsRefreshRunner({
      accountService,
      detailBuilder,
      balanceWorkflow,
    });
    runtime.onCleanup(async () => {
      await refreshRunner.awaitStream();
    });

    const value = yield* await operation({
      accountService,
      profile: profileResult.value,
      refreshRunner,
    });
    return value;
  }, 'Failed to prepare accounts refresh command scope');
}

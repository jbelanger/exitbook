import type { AccountLifecycleService } from '@exitbook/accounts';
import type { Profile } from '@exitbook/core';
import { buildBalancePorts } from '@exitbook/data/balances';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion/balance';

import type { CliOutputFormat } from '../../../cli/options.js';
import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
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
    const database = await runtime.database();
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

    const providerRuntime = await runtime.openBlockchainProviderRuntime({ registerCleanup: false });
    const cleanupBlockchainProviderRuntime = adaptResultCleanup(providerRuntime.cleanup);
    const balanceWorkflow = new BalanceWorkflow(buildBalancePorts(database), providerRuntime);
    const refreshRunner = new AccountsRefreshRunner({
      accountService,
      detailBuilder,
      balanceWorkflow,
    });
    runtime.onCleanup(async () => {
      await refreshRunner.awaitStream();
      await cleanupBlockchainProviderRuntime();
    });

    const value = yield* await operation({
      accountService,
      profile: profileResult.value,
      refreshRunner,
    });
    return value;
  }, 'Failed to prepare accounts refresh command scope');
}

import type { AccountLifecycleService } from '@exitbook/accounts';
import type { Profile } from '@exitbook/core';
import { buildBalancePorts } from '@exitbook/data/balances';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion/balance';

import type { CliOutputFormat } from '../../../cli/options.js';
import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { ensureProcessedTransactionsReady } from '../../../runtime/projection-readiness.js';
import { createCliAccountLifecycleService } from '../../accounts/account-service.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { BalanceAssetDetailsBuilder } from './balance-asset-details-builder.js';
import { BalanceVerificationRunner } from './balance-verification-runner.js';

export interface BalanceCommandScope {
  accountService: AccountLifecycleService;
  profile: Profile;
  verificationRunner: BalanceVerificationRunner;
}

export async function withBalanceCommandScope<T>(
  runtime: CommandRuntime,
  options: {
    format: CliOutputFormat;
    needsWorkflow: boolean;
  },
  operation: (scope: BalanceCommandScope) => Promise<Result<T, Error>>
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
    const assetDetailsBuilder = new BalanceAssetDetailsBuilder(database);

    if (!options.needsWorkflow) {
      const value = yield* await operation({
        accountService,
        profile: profileResult.value,
        verificationRunner: new BalanceVerificationRunner({
          accountService,
          assetDetailsBuilder,
          balanceOperation: undefined,
        }),
      });
      return value;
    }

    const providerRuntime = await runtime.openBlockchainProviderRuntime({ registerCleanup: false });
    const cleanupBlockchainProviderRuntime = adaptResultCleanup(providerRuntime.cleanup);
    const balanceWorkflow = new BalanceWorkflow(buildBalancePorts(database), providerRuntime);
    const verificationRunner = new BalanceVerificationRunner({
      accountService,
      assetDetailsBuilder,
      balanceOperation: balanceWorkflow,
    });
    runtime.onCleanup(async () => {
      await verificationRunner.awaitStream();
      await cleanupBlockchainProviderRuntime();
    });

    const value = yield* await operation({
      accountService,
      profile: profileResult.value,
      verificationRunner,
    });
    return value;
  }, 'Failed to prepare balance command scope');
}

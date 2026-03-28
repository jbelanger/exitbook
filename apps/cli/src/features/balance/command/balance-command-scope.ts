import type { Profile } from '@exitbook/core';
import { buildBalancePorts } from '@exitbook/data/balances';
import { err, wrapError, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion/balance';

import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { ensureProcessedTransactionsReady } from '../../../runtime/projection-readiness.js';
import { buildCliAccountLifecycleService } from '../../accounts/account-service.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import type { CliOutputFormat } from '../../shared/command-options.js';

import { BalanceHandler } from './balance-handler.js';

export interface BalanceCommandScope {
  handler: BalanceHandler;
  profile: Profile;
}

export async function withBalanceCommandScope<T>(
  runtime: CommandRuntime,
  options: {
    format: CliOutputFormat;
    needsWorkflow: boolean;
    prepareStoredSnapshots?: boolean | undefined;
  },
  operation: (scope: BalanceCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  try {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }

    if (options.prepareStoredSnapshots) {
      const readyResult = await ensureProcessedTransactionsReady(runtime, {
        format: options.format,
        profileId: profileResult.value.id,
      });
      if (readyResult.isErr()) {
        return err(readyResult.error);
      }
    }

    const accountService = buildCliAccountLifecycleService(database);
    if (!options.needsWorkflow) {
      return operation({
        handler: new BalanceHandler(database, undefined, accountService),
        profile: profileResult.value,
      });
    }

    const providerRuntime = await runtime.openBlockchainProviderRuntime({ registerCleanup: false });
    const cleanupBlockchainProviderRuntime = adaptResultCleanup(providerRuntime.cleanup);
    const balanceWorkflow = new BalanceWorkflow(buildBalancePorts(database), providerRuntime);
    const handler = new BalanceHandler(database, balanceWorkflow, accountService);
    runtime.onCleanup(async () => {
      await handler.awaitStream();
      await cleanupBlockchainProviderRuntime();
    });

    return operation({
      handler,
      profile: profileResult.value,
    });
  } catch (error) {
    return wrapError(error, 'Failed to prepare balance command scope');
  }
}

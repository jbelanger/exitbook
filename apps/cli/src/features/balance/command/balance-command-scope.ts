import type { Profile } from '@exitbook/core';
import { buildBalancePorts } from '@exitbook/data/balances';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion/balance';

import type { CliOutputFormat } from '../../../cli/options.js';
import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { ensureProcessedTransactionsReady } from '../../../runtime/projection-readiness.js';
import { buildCliAccountLifecycleService } from '../../accounts/account-service.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { BalanceAssetDetailsBuilder } from './balance-asset-details-builder.js';
import { BalanceStoredSnapshotReader } from './balance-stored-snapshot-reader.js';
import { BalanceVerificationRunner } from './balance-verification-runner.js';

export interface BalanceCommandScope {
  profile: Profile;
  snapshotReader: BalanceStoredSnapshotReader;
  verificationRunner: BalanceVerificationRunner;
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
  return resultTryAsync<T>(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    if (options.prepareStoredSnapshots) {
      const readyResult = await ensureProcessedTransactionsReady(runtime, {
        format: options.format,
        profileId: profileResult.value.id,
      });
      if (readyResult.isErr()) {
        return yield* err(readyResult.error);
      }
    }

    const accountService = buildCliAccountLifecycleService(database);
    const assetDetailsBuilder = new BalanceAssetDetailsBuilder(database);
    const snapshotReader = new BalanceStoredSnapshotReader({
      accountService,
      assetDetailsBuilder,
      balanceOperation: undefined,
      db: database,
    });

    if (!options.needsWorkflow) {
      const value = yield* await operation({
        profile: profileResult.value,
        snapshotReader,
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
      profile: profileResult.value,
      snapshotReader: new BalanceStoredSnapshotReader({
        accountService,
        assetDetailsBuilder,
        balanceOperation: balanceWorkflow,
        db: database,
      }),
      verificationRunner,
    });
    return value;
  }, 'Failed to prepare balance command scope');
}

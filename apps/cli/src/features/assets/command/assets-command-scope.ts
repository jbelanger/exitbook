import type { Profile } from '@exitbook/core';
import { refreshProfileAccountingIssueProjection } from '@exitbook/data/accounting';
import { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultTryAsync, type Result } from '@exitbook/foundation';
import { BalanceWorkflow } from '@exitbook/ingestion/balance';

import { adaptResultCleanup, type CommandRuntime } from '../../../runtime/command-runtime.js';
import { buildBalanceWorkflowPorts } from '../../balances/shared/build-balance-workflow-ports.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { AssetOverrideService } from './asset-override-service.js';
import { AssetSnapshotReader, type BalanceSnapshotRebuilder } from './asset-snapshot-reader.js';

export interface AssetsCommandScope {
  overrideService: AssetOverrideService;
  profile: Profile;
  refreshProfileIssues(): Promise<Result<void, Error>>;
  snapshotReader: AssetSnapshotReader;
}

export async function withAssetsCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: AssetsCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const overrideStore = new OverrideStore(runtime.dataDir);
    const snapshotReader = new AssetSnapshotReader(
      database,
      overrideStore,
      runtime.dataDir,
      createBalanceSnapshotRebuilder(runtime, database)
    );

    const value = yield* await operation({
      overrideService: new AssetOverrideService(database, overrideStore, snapshotReader),
      profile: profileResult.value,
      refreshProfileIssues: () =>
        refreshProfileAccountingIssueProjection(database, runtime.dataDir, {
          displayName: profileResult.value.displayName,
          profileId: profileResult.value.id,
          profileKey: profileResult.value.profileKey,
        }),
      snapshotReader,
    });
    return value;
  }, 'Failed to prepare assets command scope');
}

function createBalanceSnapshotRebuilder(runtime: CommandRuntime, database: DataSession): BalanceSnapshotRebuilder {
  let workflowPromise: Promise<BalanceWorkflow> | undefined;

  return {
    async rebuildCalculatedSnapshot(scopeAccountId) {
      const workflow = await getWorkflow();
      const rebuildResult = await workflow.rebuildCalculatedSnapshot({ accountId: scopeAccountId });
      if (rebuildResult.isErr()) {
        return err(rebuildResult.error);
      }

      return ok(undefined);
    },
  };

  async function getWorkflow(): Promise<BalanceWorkflow> {
    if (!workflowPromise) {
      workflowPromise = (async () => {
        const providerRuntime = await runtime.openBlockchainProviderRuntime({ registerCleanup: false });
        runtime.onCleanup(adaptResultCleanup(providerRuntime.cleanup));
        return new BalanceWorkflow(buildBalanceWorkflowPorts(database), providerRuntime);
      })();
    }

    return await workflowPromise;
  }
}

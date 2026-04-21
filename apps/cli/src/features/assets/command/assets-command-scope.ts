import type { Profile } from '@exitbook/core';
import { refreshProfileAccountingIssueProjection } from '@exitbook/data/accounting';
import { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, resultTryAsync, type Result } from '@exitbook/foundation';

import {
  createCliCommandResourceFactories,
  type CliBalanceWorkflowFactory,
} from '../../../runtime/command-capability-factories.js';
import { type CommandRuntime } from '../../../runtime/command-runtime.js';
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
    const database = await runtime.openDatabaseSession();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const overrideStore = new OverrideStore(runtime.dataDir);
    const capabilityFactories = createCliCommandResourceFactories(runtime, database);
    const snapshotReader = new AssetSnapshotReader(database, overrideStore, {
      assetReviewProjectionFactory: capabilityFactories.assetReviewProjectionFactory,
      balanceSnapshotRebuilder: createBalanceSnapshotRebuilder(capabilityFactories.balanceWorkflowFactory),
    });

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

function createBalanceSnapshotRebuilder(balanceWorkflowFactory: CliBalanceWorkflowFactory): BalanceSnapshotRebuilder {
  return {
    async rebuildCalculatedSnapshot(scopeAccountId) {
      const workflow = await balanceWorkflowFactory.getOrCreate();
      const rebuildResult = await workflow.rebuildCalculatedSnapshot({ accountId: scopeAccountId });
      if (rebuildResult.isErr()) {
        return err(rebuildResult.error);
      }

      return ok(undefined);
    },
  };
}

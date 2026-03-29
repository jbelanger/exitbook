import type { Profile } from '@exitbook/core';
import { OverrideStore } from '@exitbook/data/overrides';
import { err, wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { AssetOverrideService } from './asset-override-service.js';
import { AssetSnapshotReader } from './asset-snapshot-reader.js';

export interface AssetsCommandScope {
  overrideService: AssetOverrideService;
  profile: Profile;
  snapshotReader: AssetSnapshotReader;
}

export async function withAssetsCommandScope<T>(
  runtime: CommandRuntime,
  operation: (scope: AssetsCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  try {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }

    const overrideStore = new OverrideStore(runtime.dataDir);
    const snapshotReader = new AssetSnapshotReader(database, overrideStore, runtime.dataDir);

    return operation({
      overrideService: new AssetOverrideService(database, overrideStore, snapshotReader),
      profile: profileResult.value,
      snapshotReader,
    });
  } catch (error) {
    return wrapError(error, 'Failed to prepare assets command scope');
  }
}

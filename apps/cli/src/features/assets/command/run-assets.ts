import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { AssetsCommandScope } from './assets-command-scope.js';
import type {
  AssetsBrowseResult,
  AssetExclusionsResult,
  AssetOverrideResult,
  AssetReviewOverrideResult,
  AssetsViewResult,
} from './assets-types.js';

interface AssetOverrideParams {
  assetId?: string | undefined;
  reason?: string | undefined;
  symbol?: string | undefined;
}

export async function runAssetsExclude(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetOverrideResult, Error>> {
  return runAssetOverrideOperation(scope, () =>
    scope.overrideService.exclude({
      ...params,
      profileId: scope.profile.id,
      profileKey: scope.profile.profileKey,
    })
  );
}

export async function runAssetsInclude(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetOverrideResult, Error>> {
  return runAssetOverrideOperation(scope, () =>
    scope.overrideService.include({
      ...params,
      profileId: scope.profile.id,
      profileKey: scope.profile.profileKey,
    })
  );
}

export async function runAssetsConfirmReview(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetReviewOverrideResult, Error>> {
  return runAssetOverrideOperation(scope, () =>
    scope.overrideService.confirmReview({
      ...params,
      profileId: scope.profile.id,
      profileKey: scope.profile.profileKey,
    })
  );
}

export async function runAssetsClearReview(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetReviewOverrideResult, Error>> {
  return runAssetOverrideOperation(scope, () =>
    scope.overrideService.clearReview({
      ...params,
      profileId: scope.profile.id,
      profileKey: scope.profile.profileKey,
    })
  );
}

export async function runAssetsExclusions(scope: AssetsCommandScope): Promise<Result<AssetExclusionsResult, Error>> {
  return scope.snapshotReader.listExclusions(scope.profile.id, scope.profile.profileKey);
}

export async function runAssetsView(
  scope: AssetsCommandScope,
  params: { actionRequiredOnly?: boolean | undefined }
): Promise<Result<AssetsViewResult, Error>> {
  return scope.snapshotReader.view({
    actionRequiredOnly: params.actionRequiredOnly,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

export async function runAssetsBrowse(
  scope: AssetsCommandScope,
  params: {
    actionRequiredOnly?: boolean | undefined;
    selector?: string | undefined;
  }
): Promise<Result<AssetsBrowseResult, Error>> {
  return scope.snapshotReader.browse({
    actionRequiredOnly: params.actionRequiredOnly,
    selector: params.selector,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

async function runAssetOverrideOperation<TResult extends { changed: boolean }>(
  scope: AssetsCommandScope,
  operation: () => Promise<Result<TResult, Error>>
): Promise<Result<TResult, Error>> {
  return resultDoAsync(async function* () {
    const result = yield* await operation();

    if (result.changed) {
      yield* await scope.refreshProfileIssues();
    }

    return result;
  });
}

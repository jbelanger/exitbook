import type { Result } from '@exitbook/foundation';

import type { AssetsCommandScope } from './assets-command-scope.js';
import type {
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
  return scope.overrideService.exclude({
    ...params,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

export async function runAssetsInclude(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetOverrideResult, Error>> {
  return scope.overrideService.include({
    ...params,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

export async function runAssetsConfirmReview(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetReviewOverrideResult, Error>> {
  return scope.overrideService.confirmReview({
    ...params,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

export async function runAssetsClearReview(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetReviewOverrideResult, Error>> {
  return scope.overrideService.clearReview({
    ...params,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
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

import type { Result } from '@exitbook/foundation';

import type { AssetsCommandScope } from './assets-command-scope.js';
import type {
  AssetExclusionsResult,
  AssetOverrideResult,
  AssetReviewOverrideResult,
  AssetViewItem,
} from './assets-handler.js';

interface AssetOverrideParams {
  assetId?: string | undefined;
  reason?: string | undefined;
  symbol?: string | undefined;
}

interface AssetsViewResult {
  actionRequiredCount: number;
  assets: AssetViewItem[];
  excludedCount: number;
  totalCount: number;
}

export async function runAssetsExclude(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetOverrideResult, Error>> {
  return scope.handler.exclude({
    ...params,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

export async function runAssetsInclude(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetOverrideResult, Error>> {
  return scope.handler.include({
    ...params,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

export async function runAssetsConfirmReview(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetReviewOverrideResult, Error>> {
  return scope.handler.confirmReview({
    ...params,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

export async function runAssetsClearReview(
  scope: AssetsCommandScope,
  params: AssetOverrideParams
): Promise<Result<AssetReviewOverrideResult, Error>> {
  return scope.handler.clearReview({
    ...params,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

export async function runAssetsExclusions(scope: AssetsCommandScope): Promise<Result<AssetExclusionsResult, Error>> {
  return scope.handler.listExclusions(scope.profile.id, scope.profile.profileKey);
}

export async function runAssetsView(
  scope: AssetsCommandScope,
  params: { actionRequiredOnly?: boolean | undefined }
): Promise<Result<AssetsViewResult, Error>> {
  return scope.handler.view({
    actionRequiredOnly: params.actionRequiredOnly,
    profileId: scope.profile.id,
    profileKey: scope.profile.profileKey,
  });
}

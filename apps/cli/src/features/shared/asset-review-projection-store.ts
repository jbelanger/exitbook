import type { AssetReviewSummary } from '@exitbook/core';
import { buildProfileProjectionScopeKey } from '@exitbook/data/projections';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

export function readAssetReviewProjectionSummaries(
  db: DataSession,
  profileId: number,
  assetIds?: string[]
): Promise<Result<Map<string, AssetReviewSummary>, Error>> {
  if (assetIds && assetIds.length === 0) {
    return Promise.resolve(ok(new Map()));
  }

  if (assetIds) {
    return db.assetReview.getByAssetIds(profileId, assetIds);
  }

  return db.assetReview.listAll(profileId).then((summariesResult) => {
    if (summariesResult.isErr()) {
      return err(summariesResult.error);
    }

    return ok(new Map(summariesResult.value.map((summary) => [summary.assetId, summary])));
  });
}

export function invalidateAssetReviewProjection(
  db: DataSession,
  profileId: number,
  reason: string
): Promise<Result<void, Error>> {
  return db.projectionState.markStale('asset-review', reason, buildProfileProjectionScopeKey(profileId));
}

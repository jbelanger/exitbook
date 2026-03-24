import type { AssetReviewSummary } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

export function readAssetReviewProjectionSummaries(
  db: DataSession,
  assetIds?: string[]
): Promise<Result<Map<string, AssetReviewSummary>, Error>> {
  if (assetIds && assetIds.length === 0) {
    return Promise.resolve(ok(new Map()));
  }

  if (assetIds) {
    return db.assetReview.getByAssetIds(assetIds);
  }

  return db.assetReview.listAll().then((summariesResult) => {
    if (summariesResult.isErr()) {
      return err(summariesResult.error);
    }

    return ok(new Map(summariesResult.value.map((summary) => [summary.assetId, summary])));
  });
}

export function invalidateAssetReviewProjection(db: DataSession, reason: string): Promise<Result<void, Error>> {
  return db.projectionState.markStale('asset-review', reason);
}

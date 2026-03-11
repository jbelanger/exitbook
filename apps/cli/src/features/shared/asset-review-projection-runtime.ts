import type { AssetReviewSummary } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { buildAssetReviewFreshnessPorts, buildAssetReviewProjectionDataPorts, type DataContext } from '@exitbook/data';
import { AssetReviewProjectionWorkflow } from '@exitbook/ingestion';

import { createAssetReviewProjectionHostDependencies } from './asset-review-projection-dependencies.js';

export async function readAssetReviewProjection(
  db: DataContext,
  dataDir: string,
  assetIds?: string[]
): Promise<Result<Map<string, AssetReviewSummary>, Error>> {
  const freshnessResult = await buildAssetReviewFreshnessPorts(db).checkFreshness();
  if (freshnessResult.isErr()) {
    return err(freshnessResult.error);
  }

  if (freshnessResult.value.status !== 'fresh') {
    const rebuildResult = await rebuildAssetReviewProjection(db, dataDir);
    if (rebuildResult.isErr()) {
      return err(rebuildResult.error);
    }
  }

  if (assetIds && assetIds.length === 0) {
    return ok(new Map());
  }

  if (assetIds) {
    return db.assetReview.getByAssetIds(assetIds);
  }

  const summariesResult = await db.assetReview.listAll();
  if (summariesResult.isErr()) {
    return err(summariesResult.error);
  }

  return ok(new Map(summariesResult.value.map((summary) => [summary.assetId, summary])));
}

export async function rebuildAssetReviewProjection(db: DataContext, dataDir: string): Promise<Result<void, Error>> {
  const hostDependencies = await createAssetReviewProjectionHostDependencies(dataDir);
  const workflow = new AssetReviewProjectionWorkflow({
    ...buildAssetReviewProjectionDataPorts(db),
    loadReviewDecisions: hostDependencies.loadReviewDecisions,
  });

  try {
    const rebuildResult = await workflow.rebuild({
      tokenMetadataReader: hostDependencies.tokenMetadataReader,
      referenceResolver: hostDependencies.referenceResolver,
    });
    if (rebuildResult.isErr()) {
      return err(rebuildResult.error);
    }

    return ok(undefined);
  } finally {
    await hostDependencies.close();
  }
}

export async function invalidateAssetReviewProjection(db: DataContext, reason: string): Promise<Result<void, Error>> {
  return db.projectionState.markStale('asset-review', reason);
}

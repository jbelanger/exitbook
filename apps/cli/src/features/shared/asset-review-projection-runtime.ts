import type { AssetReviewSummary } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { buildAssetReviewFreshnessPorts, buildAssetReviewProjectionDataPorts, type DataContext } from '@exitbook/data';
import { AssetReviewProjectionWorkflow } from '@exitbook/ingestion';

import { findLatestAssetReviewExternalInputAt } from './asset-review-external-input-freshness.js';
import { openAssetReviewProjectionSupport } from './asset-review-projection-support.js';

/**
 * Ensures the asset-review projection is current. This may rebuild and initialize provider support.
 */
export async function ensureAssetReviewProjectionFresh(db: DataContext, dataDir: string): Promise<Result<void, Error>> {
  const freshnessResult = await buildAssetReviewFreshnessPorts(db).checkFreshness();
  if (freshnessResult.isErr()) {
    return err(freshnessResult.error);
  }

  let needsRebuild = freshnessResult.value.status !== 'fresh';
  if (!needsRebuild) {
    const externalStalenessResult = await findAssetReviewExternalStalenessReason(db, dataDir);
    if (externalStalenessResult.isErr()) {
      return err(externalStalenessResult.error);
    }

    needsRebuild = externalStalenessResult.value !== undefined;
  }

  if (needsRebuild) {
    const rebuildResult = await rebuildAssetReviewProjection(db, dataDir);
    if (rebuildResult.isErr()) {
      return err(rebuildResult.error);
    }
  }

  return ok(undefined);
}

/**
 * Reads stored asset-review summaries without triggering a rebuild.
 */
export async function readAssetReviewProjectionSummaries(
  db: DataContext,
  assetIds?: string[]
): Promise<Result<Map<string, AssetReviewSummary>, Error>> {
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
  const projectionSupportResult = await openAssetReviewProjectionSupport(dataDir);
  if (projectionSupportResult.isErr()) {
    return err(projectionSupportResult.error);
  }

  const projectionSupport = projectionSupportResult.value;
  const workflow = new AssetReviewProjectionWorkflow({
    ...buildAssetReviewProjectionDataPorts(db),
    loadReviewDecisions: projectionSupport.loadReviewDecisions,
  });

  try {
    const rebuildResult = await workflow.rebuild({
      tokenMetadataReader: projectionSupport.tokenMetadataReader,
      referenceResolver: projectionSupport.referenceResolver,
    });
    if (rebuildResult.isErr()) {
      return err(rebuildResult.error);
    }

    return ok(undefined);
  } finally {
    await projectionSupport.close();
  }
}

export async function invalidateAssetReviewProjection(db: DataContext, reason: string): Promise<Result<void, Error>> {
  return db.projectionState.markStale('asset-review', reason);
}

async function findAssetReviewExternalStalenessReason(
  db: DataContext,
  dataDir: string
): Promise<Result<string | undefined, Error>> {
  const stateResult = await db.projectionState.get('asset-review');
  if (stateResult.isErr()) {
    return err(stateResult.error);
  }

  const lastBuiltAt = stateResult.value?.lastBuiltAt;
  if (!lastBuiltAt) {
    return ok(undefined);
  }

  const latestExternalInputAtResult = await findLatestAssetReviewExternalInputAt(dataDir);
  if (latestExternalInputAtResult.isErr()) {
    return err(latestExternalInputAtResult.error);
  }

  const latestExternalInputAt = latestExternalInputAtResult.value;
  if (!latestExternalInputAt || latestExternalInputAt <= lastBuiltAt) {
    return ok(undefined);
  }

  return ok('asset review external inputs changed since last rebuild');
}

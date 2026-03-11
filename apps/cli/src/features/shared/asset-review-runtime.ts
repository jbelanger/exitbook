import path from 'node:path';

import {
  closeTokenMetadataDatabase,
  createCoinGeckoTokenReferenceResolver,
  createTokenMetadataDatabase,
  createTokenMetadataQueries,
  initializeTokenMetadataDatabase,
  type TokenMetadataDB,
  type TokenReferenceResolver,
} from '@exitbook/blockchain-providers';
import type { AssetReviewSummary } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import {
  buildAssetReviewFreshnessPorts,
  buildAssetReviewProjectionPorts,
  OverrideStore,
  readAssetReviewDecisions,
  type DataContext,
} from '@exitbook/data';
import { AssetReviewProjectionWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('asset-review-runtime');

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
  const overrideStore = new OverrideStore(dataDir);
  const workflow = new AssetReviewProjectionWorkflow({
    ...buildAssetReviewProjectionPorts(db),
    loadReviewDecisions: () => readAssetReviewDecisions(overrideStore),
  });

  let tokenMetadataDb: TokenMetadataDB | undefined;
  let tokenReferenceResolver: TokenReferenceResolver | undefined;
  let tokenMetadataQueries: ReturnType<typeof createTokenMetadataQueries> | undefined;

  try {
    const dbResult = createTokenMetadataDatabase(path.join(dataDir, 'token-metadata.db'));
    if (dbResult.isOk()) {
      tokenMetadataDb = dbResult.value;
      const migrationResult = await initializeTokenMetadataDatabase(tokenMetadataDb);
      if (migrationResult.isErr()) {
        logger.warn({ error: migrationResult.error }, 'Failed to initialize token metadata database for asset review');
      } else {
        tokenMetadataQueries = createTokenMetadataQueries(tokenMetadataDb);
        const resolverResult = createCoinGeckoTokenReferenceResolver(tokenMetadataQueries);
        if (resolverResult.isErr()) {
          logger.warn({ error: resolverResult.error }, 'Failed to initialize CoinGecko token reference resolver');
        } else {
          tokenReferenceResolver = resolverResult.value;
        }
      }
    } else {
      logger.warn({ error: dbResult.error }, 'Failed to open token metadata database for asset review');
    }

    const rebuildResult = await workflow.rebuild({
      tokenMetadataReader: tokenMetadataQueries,
      referenceResolver: tokenReferenceResolver,
    });
    if (rebuildResult.isErr()) {
      return err(rebuildResult.error);
    }

    return ok(undefined);
  } finally {
    if (tokenReferenceResolver) {
      await tokenReferenceResolver.close().catch((error: unknown) => {
        logger.warn({ error }, 'Failed to close token reference resolver');
      });
    }

    if (tokenMetadataDb) {
      await closeTokenMetadataDatabase(tokenMetadataDb).catch((error: unknown) => {
        logger.warn({ error }, 'Failed to close token metadata database after asset review rebuild');
      });
    }
  }
}

export async function invalidateAssetReviewProjection(db: DataContext, reason: string): Promise<Result<void, Error>> {
  return db.projectionState.markStale('asset-review', reason);
}

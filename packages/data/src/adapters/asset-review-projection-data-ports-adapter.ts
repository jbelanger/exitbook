import { err, type AssetReviewSummary } from '@exitbook/core';
import type { IAssetReviewProjectionDataSource, IAssetReviewProjectionStore } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

export function buildAssetReviewProjectionDataPorts(
  db: DataContext
): IAssetReviewProjectionDataSource & IAssetReviewProjectionStore {
  return {
    listTransactions: () => db.transactions.findAll({ includeExcluded: true }),

    markAssetReviewBuilding: () => db.projectionState.markBuilding('asset-review'),

    replaceAssetReviewProjection: (summaries: Iterable<AssetReviewSummary>, metadata: { assetCount: number }) =>
      db.executeInTransaction(async (tx) => {
        const replaceResult = await tx.assetReview.replaceAll(summaries);
        if (replaceResult.isErr()) {
          return err(replaceResult.error);
        }

        return tx.projectionState.markFresh('asset-review', metadata);
      }),

    markAssetReviewFailed: () => db.projectionState.markFailed('asset-review'),
  };
}

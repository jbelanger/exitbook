import type { AssetReviewSummary } from '@exitbook/core';
import { err, type Result } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

import { buildProfileProjectionScopeKey } from './profile-scope-key.js';

interface AssetReviewProjectionDataPorts {
  listTransactions: () => ReturnType<DataSession['transactions']['findAll']>;
  markAssetReviewBuilding: () => ReturnType<DataSession['projectionState']['markBuilding']>;
  replaceAssetReviewProjection: (
    summaries: Iterable<AssetReviewSummary>,
    metadata: { assetCount: number }
  ) => Promise<Result<void, Error>>;
  markAssetReviewFailed: () => ReturnType<DataSession['projectionState']['markFailed']>;
}

export function buildAssetReviewProjectionDataPorts(
  db: DataSession,
  profileId: number
): AssetReviewProjectionDataPorts {
  const scopeKey = buildProfileProjectionScopeKey(profileId);

  return {
    listTransactions: () => db.transactions.findAll({ profileId, includeExcluded: true }),

    markAssetReviewBuilding: () => db.projectionState.markBuilding('asset-review', scopeKey),

    replaceAssetReviewProjection: (summaries: Iterable<AssetReviewSummary>, metadata: { assetCount: number }) =>
      db.executeInTransaction(async (tx) => {
        const replaceResult = await tx.assetReview.replaceAll(profileId, summaries);
        if (replaceResult.isErr()) {
          return err(replaceResult.error);
        }

        return tx.projectionState.markFresh('asset-review', metadata, scopeKey);
      }),

    markAssetReviewFailed: () => db.projectionState.markFailed('asset-review', scopeKey),
  };
}

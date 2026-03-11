import { resultDoAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

export function buildAssetReviewResetPorts(db: DataContext): {
  countResetImpact(accountIds?: number[]): Promise<import('@exitbook/core').Result<{ assets: number }, Error>>;
  reset(accountIds?: number[]): Promise<import('@exitbook/core').Result<{ assets: number }, Error>>;
} {
  return {
    async countResetImpact(accountIds) {
      void accountIds;
      return resultDoAsync(async function* () {
        const assets = yield* await db.assetReview.countStates();
        return { assets };
      });
    },

    async reset(accountIds) {
      void accountIds;
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const assets = yield* await tx.assetReview.deleteAll();
          yield* await tx.projectionState.markStale('asset-review', 'reset');
          return { assets };
        })
      );
    },
  };
}

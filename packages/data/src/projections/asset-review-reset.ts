import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

import { buildProfileProjectionScopeKey, resolveAffectedProfileIds } from './profile-scope-key.js';

export function buildAssetReviewResetPorts(db: DataSession): {
  countResetImpact(accountIds?: number[]): Promise<import('@exitbook/foundation').Result<{ assets: number }, Error>>;
  reset(accountIds?: number[]): Promise<import('@exitbook/foundation').Result<{ assets: number }, Error>>;
} {
  return {
    async countResetImpact(accountIds) {
      return resultDoAsync(async function* () {
        const profileIds = yield* await resolveAffectedProfileIds(db, accountIds);
        let assets = 0;

        for (const profileId of profileIds) {
          assets += yield* await db.assetReview.countStates(profileId);
        }

        return { assets };
      });
    },

    async reset(accountIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const profileIds = yield* await resolveAffectedProfileIds(tx, accountIds);
          let assets = 0;

          for (const profileId of profileIds) {
            assets += yield* await tx.assetReview.deleteAll(profileId);
            yield* await tx.projectionState.markStale(
              'asset-review',
              'reset',
              buildProfileProjectionScopeKey(profileId)
            );
          }

          return { assets };
        })
      );
    },
  };
}

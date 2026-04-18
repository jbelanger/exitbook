import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';
import { buildProfileProjectionScopeKey } from '../projections/profile-scope-key.js';

export function buildCostBasisResetPorts(db: DataSession): {
  countResetImpact(profileIds?: number[]): Promise<import('@exitbook/foundation').Result<{ snapshots: number }, Error>>;
  reset(profileIds?: number[]): Promise<import('@exitbook/foundation').Result<{ snapshots: number }, Error>>;
} {
  function toScopeKeys(profileIds?: number[]): string[] | undefined {
    if (!profileIds) {
      return undefined;
    }

    return [...new Set(profileIds)].map((profileId) => buildProfileProjectionScopeKey(profileId));
  }

  return {
    async countResetImpact(profileIds) {
      return resultDoAsync(async function* () {
        const scopeKeys = toScopeKeys(profileIds);
        const snapshots = yield* await db.costBasisSnapshots.count(scopeKeys);
        const failureSnapshots = yield* await db.costBasisFailureSnapshots.count(scopeKeys);
        return { snapshots: snapshots + failureSnapshots };
      });
    },

    async reset(profileIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const scopeKeys = toScopeKeys(profileIds);
          const snapshots = yield* await tx.costBasisSnapshots.deleteLatest(scopeKeys);
          const failureSnapshots = yield* await tx.costBasisFailureSnapshots.deleteLatest(scopeKeys);
          return { snapshots: snapshots + failureSnapshots };
        })
      );
    },
  };
}

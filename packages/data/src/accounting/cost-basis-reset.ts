import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

export function buildCostBasisResetPorts(db: DataSession): {
  countResetImpact(): Promise<import('@exitbook/foundation').Result<{ snapshots: number }, Error>>;
  reset(): Promise<import('@exitbook/foundation').Result<{ snapshots: number }, Error>>;
} {
  return {
    async countResetImpact() {
      return resultDoAsync(async function* () {
        const snapshots = yield* await db.costBasisSnapshots.count();
        const failureSnapshots = yield* await db.costBasisFailureSnapshots.count();
        return { snapshots: snapshots + failureSnapshots };
      });
    },

    async reset() {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const snapshots = yield* await tx.costBasisSnapshots.deleteLatest();
          const failureSnapshots = yield* await tx.costBasisFailureSnapshots.deleteLatest();
          return { snapshots: snapshots + failureSnapshots };
        })
      );
    },
  };
}

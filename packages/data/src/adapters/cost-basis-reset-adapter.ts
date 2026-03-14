import { resultDoAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

export function buildCostBasisResetPorts(db: DataContext): {
  countResetImpact(): Promise<import('@exitbook/core').Result<{ snapshots: number }, Error>>;
  reset(): Promise<import('@exitbook/core').Result<{ snapshots: number }, Error>>;
} {
  return {
    async countResetImpact() {
      return resultDoAsync(async function* () {
        const snapshots = yield* await db.costBasisSnapshots.count();
        return { snapshots };
      });
    },

    async reset() {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const snapshots = yield* await tx.costBasisSnapshots.deleteLatest();
          return { snapshots };
        })
      );
    },
  };
}

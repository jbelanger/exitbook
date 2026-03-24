import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

import { resolveBalanceScopeAccountIds, toBalanceScopeKey } from './balance-scope-utils.js';

async function countAssetRows(db: DataSession, scopeAccountIds?: number[]): Promise<Result<number, Error>> {
  return resultDoAsync(async function* () {
    const assets = yield* await db.balanceSnapshots.findAssetsByScope(scopeAccountIds);
    return assets.length;
  });
}

export function buildBalancesResetPorts(db: DataSession): {
  countResetImpact(accountIds?: number[]): Promise<Result<{ assetRows: number; scopes: number }, Error>>;
  reset(accountIds?: number[]): Promise<Result<{ assetRows: number; scopes: number }, Error>>;
} {
  return {
    async countResetImpact(accountIds) {
      return resultDoAsync(async function* () {
        const scopeAccountIds = yield* await resolveBalanceScopeAccountIds(db, accountIds);
        const snapshots = yield* await db.balanceSnapshots.findSnapshots(scopeAccountIds);
        const assetRows = yield* await countAssetRows(db, scopeAccountIds);

        return { scopes: snapshots.length, assetRows };
      });
    },

    async reset(accountIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const scopeAccountIds = yield* await resolveBalanceScopeAccountIds(tx, accountIds);
          const snapshots = yield* await tx.balanceSnapshots.findSnapshots(scopeAccountIds);
          const assetRows = yield* await countAssetRows(tx, scopeAccountIds);
          const deletedScopes = yield* await tx.balanceSnapshots.deleteByScopeAccountIds(scopeAccountIds);
          const staleScopeIds = scopeAccountIds ?? snapshots.map((snapshot) => snapshot.scopeAccountId);

          for (const scopeAccountId of staleScopeIds) {
            yield* await tx.projectionState.markStale('balances', 'reset', toBalanceScopeKey(scopeAccountId));
          }

          return { scopes: deletedScopes, assetRows };
        })
      );
    },
  };
}

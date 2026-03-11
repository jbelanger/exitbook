import { err, ok, resultDoAsync, type Result } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

function toBalanceScopeKey(scopeAccountId: number): string {
  return `balance:${scopeAccountId}`;
}

async function resolveBalanceScopeAccountIds(
  db: DataContext,
  accountIds?: number[]
): Promise<Result<number[] | undefined, Error>> {
  if (!accountIds) {
    return ok(undefined);
  }

  const scopeIds = new Set<number>();

  for (const accountId of accountIds) {
    const accountResult = await db.accounts.findById(accountId);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }

    scopeIds.add(accountResult.value.parentAccountId ?? accountResult.value.id);
  }

  return ok([...scopeIds]);
}

async function countAssetRows(db: DataContext, scopeAccountIds?: number[]): Promise<Result<number, Error>> {
  return resultDoAsync(async function* () {
    const assets = yield* await db.balanceSnapshots.findAssetsByScope(scopeAccountIds);
    return assets.length;
  });
}

export function buildBalancesResetPorts(db: DataContext): {
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

          for (const snapshot of snapshots) {
            yield* await tx.projectionState.markStale('balances', 'reset', toBalanceScopeKey(snapshot.scopeAccountId));
          }

          return { scopes: deletedScopes, assetRows };
        })
      );
    },
  };
}

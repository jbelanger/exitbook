import { cascadeInvalidation, type ProjectionId } from '@exitbook/core';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import { resolveBalanceScopeAccountIds, toBalanceScopeKey } from '../balances/balance-scope.js';
import type { DataSession } from '../data-session.js';

import { buildProfileProjectionScopeKey, resolveAffectedProfileIds } from './profile-scope-key.js';

async function resolveExistingBalanceScopeIds(db: DataSession): Promise<Result<number[], Error>> {
  return resultDoAsync(async function* () {
    const snapshots = yield* await db.balanceSnapshots.findSnapshots();
    return snapshots.map((snapshot) => snapshot.scopeAccountId);
  });
}

export async function markDownstreamProjectionsStale(params: {
  accountIds?: number[] | undefined;
  db: DataSession;
  from: ProjectionId;
  reason: string;
}): Promise<Result<void, Error>> {
  const { accountIds, db, from, reason } = params;

  return resultDoAsync(async function* () {
    const downstreamProjections = cascadeInvalidation(from);

    for (const downstream of downstreamProjections) {
      if (downstream === 'links') {
        const profileIds = yield* await resolveAffectedProfileIds(db, accountIds);
        for (const profileId of profileIds) {
          yield* await db.projectionState.markStale('links', reason, buildProfileProjectionScopeKey(profileId));
        }
        continue;
      }

      if (downstream !== 'balances') {
        yield* await db.projectionState.markStale(downstream, reason);
        continue;
      }

      const scopeIdsResult = accountIds
        ? await resolveBalanceScopeAccountIds(db, accountIds)
        : await resolveExistingBalanceScopeIds(db);
      const scopeIds = yield* scopeIdsResult;

      for (const scopeId of scopeIds ?? []) {
        yield* await db.projectionState.markStale('balances', reason, toBalanceScopeKey(scopeId));
      }
    }
  });
}

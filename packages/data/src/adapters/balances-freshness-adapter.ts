import { resultDoAsync, type ProjectionStatus, type Result } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

import { toBalanceScopeKey } from './balance-scope-utils.js';

export function buildBalancesFreshnessPorts(db: DataContext): {
  checkFreshness(
    scopeAccountId: number
  ): Promise<Result<{ reason: string | undefined; status: ProjectionStatus }, Error>>;
} {
  return {
    async checkFreshness(scopeAccountId) {
      return resultDoAsync(async function* () {
        const scopeKey = toBalanceScopeKey(scopeAccountId);
        const state = yield* await db.projectionState.get('balances', scopeKey);
        const snapshot = yield* await db.balanceSnapshots.findSnapshot(scopeAccountId);

        if (state && (state.status === 'stale' || state.status === 'failed' || state.status === 'building')) {
          return { status: state.status, reason: state.invalidatedBy ?? `projection is ${state.status}` };
        }

        if (!snapshot) {
          return { status: 'stale' as const, reason: 'balance snapshot has never been built' };
        }

        if (state?.status === 'fresh') {
          return { status: 'fresh' as const, reason: undefined };
        }

        return { status: 'fresh' as const, reason: undefined };
      });
    },
  };
}

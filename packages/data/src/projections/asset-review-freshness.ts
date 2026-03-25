import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

export function buildAssetReviewFreshnessPorts(db: DataSession): {
  checkFreshness(): Promise<
    import('@exitbook/foundation').Result<
      { reason: string | undefined; status: import('@exitbook/core').ProjectionStatus },
      Error
    >
  >;
} {
  return {
    async checkFreshness() {
      return resultDoAsync(async function* () {
        const state = yield* await db.projectionState.get('asset-review');

        if (state && (state.status === 'stale' || state.status === 'failed' || state.status === 'building')) {
          return { status: state.status, reason: state.invalidatedBy ?? `projection is ${state.status}` };
        }

        if (state && state.status === 'fresh') {
          return { status: 'fresh' as const, reason: undefined };
        }

        const latestTx = yield* await db.transactions.findLatestCreatedAt();
        if (!latestTx) {
          return { status: 'fresh' as const, reason: undefined };
        }

        const latestComputedAt = yield* await db.assetReview.findLatestComputedAt();
        if (!latestComputedAt || latestComputedAt < latestTx) {
          return {
            status: 'stale' as const,
            reason: latestComputedAt
              ? 'new transactions since last asset review rebuild'
              : 'asset review has never been built',
          };
        }

        return { status: 'fresh' as const, reason: undefined };
      });
    },
  };
}

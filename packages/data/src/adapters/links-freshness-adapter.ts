import type { ILinksFreshness } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext to accounting's ILinksFreshness port.
 *
 * Detects staleness via:
 * - Projection state explicitly marked stale/failed/building
 * - No links exist but transactions do (timestamp comparison)
 * - Newest transaction is newer than newest link
 */
export function buildLinksFreshnessPorts(db: DataContext): ILinksFreshness {
  return {
    async checkFreshness() {
      return resultDoAsync(async function* () {
        const state = yield* await db.projectionState.get('links');

        if (state && (state.status === 'stale' || state.status === 'failed' || state.status === 'building')) {
          return { status: state.status, reason: state.invalidatedBy ?? `projection is ${state.status}` };
        }

        // Timestamp comparison: latest transaction vs latest link
        const latestTx = yield* await db.transactions.findLatestCreatedAt();
        if (!latestTx) {
          // No transactions => nothing to link, consider fresh
          return { status: 'fresh' as const, reason: undefined };
        }

        const latestLink = yield* await db.transactionLinks.findLatestCreatedAt();
        if (!latestLink || latestLink < latestTx) {
          return {
            status: 'stale' as const,
            reason: latestLink ? 'new transactions since last linking' : 'no links exist',
          };
        }

        return { status: 'fresh' as const, reason: undefined };
      });
    },
  };
}

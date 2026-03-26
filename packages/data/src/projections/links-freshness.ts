import type { ILinksFreshness } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

import { buildProfileProjectionScopeKey } from './profile-scope-key.js';

/**
 * Bridges DataSession to accounting's ILinksFreshness port.
 *
 * Detects profile-scoped link staleness via:
 * - Projection state explicitly marked stale/failed/building
 * - No links exist but transactions do (timestamp comparison)
 * - Newest transaction is newer than newest link
 */
export function buildLinksFreshnessPorts(db: DataSession, profileId: number): ILinksFreshness {
  const scopeKey = buildProfileProjectionScopeKey(profileId);

  return {
    async checkFreshness() {
      return resultDoAsync(async function* () {
        const state = yield* await db.projectionState.get('links', scopeKey);

        if (state && (state.status === 'stale' || state.status === 'failed' || state.status === 'building')) {
          return { status: state.status, reason: state.invalidatedBy ?? `projection is ${state.status}` };
        }

        // Projection state says fresh — trust it (linking ran and marked fresh, even if zero links produced)
        if (state && state.status === 'fresh') {
          return { status: 'fresh' as const, reason: undefined };
        }

        // No projection state row yet — fall back to timestamp heuristic for first run.
        const latestTx = yield* await db.transactions.findLatestCreatedAt(profileId);
        if (!latestTx) {
          // No transactions => nothing to link, consider fresh
          return { status: 'fresh' as const, reason: undefined };
        }

        const latestLink = yield* await db.transactionLinks.findLatestCreatedAt(profileId);
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

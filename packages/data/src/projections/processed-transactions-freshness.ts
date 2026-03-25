import { resultDoAsync } from '@exitbook/foundation';
import type { IProcessedTransactionsFreshness } from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';
import { computeAccountHash } from '../utils/account-hash.js';

/**
 * Bridges DataSession to ingestion's IProcessedTransactionsFreshness port.
 *
 * Detects staleness via:
 * - No projection state row (never processed)
 * - Account hash mismatch (account graph changed)
 * - New import completed since last build
 * - Projection state explicitly marked stale/failed/building
 */
export function buildProcessedTransactionsFreshnessPorts(db: DataSession): IProcessedTransactionsFreshness {
  return {
    async checkFreshness() {
      return resultDoAsync(async function* () {
        // No raw data => nothing to process, consider fresh
        const rawAccountIds = yield* await db.rawTransactions.findDistinctAccountIds({});
        if (rawAccountIds.length === 0) {
          return { status: 'fresh' as const, reason: undefined };
        }

        const state = yield* await db.projectionState.get('processed-transactions');

        if (!state) {
          return { status: 'stale' as const, reason: 'raw data has never been processed' };
        }

        if (state.status === 'stale' || state.status === 'failed' || state.status === 'building') {
          return { status: state.status, reason: state.invalidatedBy ?? `projection is ${state.status}` };
        }

        // Check account hash
        const currentHash = yield* await computeAccountHash(db);
        const storedHash = state.metadata?.['accountHash'] as string | undefined;
        if (storedHash !== currentHash) {
          return { status: 'stale' as const, reason: 'account graph changed' };
        }

        // Check if any import completed after last build
        if (state.lastBuiltAt) {
          const latestImport = yield* await db.importSessions.findLatestCompletedAt();
          if (latestImport && latestImport > state.lastBuiltAt) {
            return { status: 'stale' as const, reason: 'new import completed since last build' };
          }
        }

        return { status: 'fresh' as const, reason: undefined };
      });
    },
  };
}

import { resultDoAsync } from '@exitbook/core';
import type { IProcessedTransactionsFreshness } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

/**
 * Compute a deterministic hash of the current account graph.
 * Changes when accounts are added, removed, or their identifiers change.
 */
async function computeAccountHash(db: DataContext) {
  return resultDoAsync(async function* () {
    const accounts = yield* await db.accounts.findAll();
    const sorted = accounts.map((a) => `${a.id}:${a.identifier}`).sort();
    const raw = sorted.join('|');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(36);
  });
}

/**
 * Bridges DataContext to ingestion's IProcessedTransactionsFreshness port.
 *
 * Detects staleness via:
 * - No projection state row (never processed)
 * - Account hash mismatch (account graph changed)
 * - New import completed since last build
 * - Projection state explicitly marked stale/failed/building
 */
export function buildProcessedTransactionsFreshnessPorts(db: DataContext): IProcessedTransactionsFreshness {
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

import { resultDoAsync } from '@exitbook/foundation';
import type { ImportPorts } from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';
import { buildProfileProjectionScopeKey, resolveAffectedProfileIds } from '../projections/profile-scope-key.js';
import { markDownstreamProjectionsStale } from '../projections/projection-invalidation.js';

/**
 * Bridges DataSession repositories to ingestion's ImportPorts.
 * Mirrors the pattern established by buildProcessingPorts.
 */
export function buildImportPorts(db: DataSession): ImportPorts {
  return {
    createAccount: (params) => db.accounts.create(params),
    findAccountById: (accountId) => db.accounts.findById(accountId),
    findAccounts: (filters) => db.accounts.findAll(filters),
    updateAccount: (id, updates) => db.accounts.update(id, updates),
    updateAccountCursor: (id, streamType, cursor) => db.accounts.updateCursor(id, streamType, cursor),

    createImportSession: (accountId) => db.importSessions.create(accountId),
    findLatestIncompleteImportSession: (accountId) => db.importSessions.findLatestIncomplete(accountId),
    updateImportSession: (sessionId, updates) => {
      // Strip undefined values — exactOptionalPropertyTypes means the Kysely
      // Updateable type does not accept explicit undefined for status.
      const cleaned = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      return db.importSessions.update(sessionId, cleaned);
    },
    finalizeImportSession: (sessionId, { status, startTime, imported, skipped, errorMessage, metadata }) => {
      return db.importSessions.finalize(sessionId, status, startTime, imported, skipped, errorMessage, metadata);
    },
    findImportSessionById: (sessionId) => db.importSessions.findById(sessionId),

    createRawTransactionBatch: (accountId, transactions) => db.rawTransactions.createBatch(accountId, transactions),
    countRawTransactionsByStreamType: (accountId) => db.rawTransactions.countByStreamType(accountId),

    invalidateProjections: (accountIds, reason) =>
      resultDoAsync(async function* () {
        const profileIds = yield* await resolveAffectedProfileIds(db, accountIds);
        for (const profileId of profileIds) {
          yield* await db.projectionState.markStale(
            'processed-transactions',
            reason,
            buildProfileProjectionScopeKey(profileId)
          );
        }
        yield* await markDownstreamProjectionsStale({
          accountIds,
          db,
          from: 'processed-transactions',
          reason: 'upstream-import:processed-transactions',
        });
      }),

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildImportPorts(txDb))),
  };
}

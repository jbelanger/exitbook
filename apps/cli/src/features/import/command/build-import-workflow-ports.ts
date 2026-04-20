import {
  buildProfileProjectionScopeKey,
  markDownstreamProjectionsStale,
  resolveAffectedProfileIds,
} from '@exitbook/data/projections';
import type { DataSession } from '@exitbook/data/session';
import { resultDoAsync } from '@exitbook/foundation';
import type { ImportPorts } from '@exitbook/ingestion/ports';

export function buildImportWorkflowPorts(db: DataSession): ImportPorts {
  return {
    createAccount: db.accounts.create.bind(db.accounts),
    findAccountById: db.accounts.findById.bind(db.accounts),
    findAccounts: db.accounts.findAll.bind(db.accounts),
    updateAccount: db.accounts.update.bind(db.accounts),
    updateAccountCursor: db.accounts.updateCursor.bind(db.accounts),
    createImportSession: db.importSessions.create.bind(db.importSessions),
    findLatestIncompleteImportSession: db.importSessions.findLatestIncomplete.bind(db.importSessions),
    updateImportSession: (sessionId, updates) => {
      // exactOptionalPropertyTypes means repository updates must omit undefined fields.
      const cleaned = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
      return db.importSessions.update(sessionId, cleaned);
    },
    finalizeImportSession: (sessionId, { status, startTime, imported, skipped, errorMessage, metadata }) =>
      db.importSessions.finalize(sessionId, status, startTime, imported, skipped, errorMessage, metadata),
    findImportSessionById: db.importSessions.findById.bind(db.importSessions),
    createRawTransactionBatch: db.rawTransactions.createBatch.bind(db.rawTransactions),
    countRawTransactionsByStreamType: db.rawTransactions.countByStreamType.bind(db.rawTransactions),
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
    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildImportWorkflowPorts(txDb))),
  };
}

import { resultDoAsync } from '@exitbook/foundation';
import type { ImportPorts } from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';
import { markDownstreamProjectionsStale } from '../projections/projection-invalidation.js';

/**
 * Bridges DataSession repositories to ingestion's ImportPorts.
 * Mirrors the pattern established by buildProcessingPorts.
 */
export function buildImportPorts(db: DataSession): ImportPorts {
  return {
    users: {
      findOrCreateDefault: () => db.users.findOrCreateDefault(),
    },

    accounts: {
      findOrCreate: (params) => db.accounts.findOrCreate(params),
      findAll: (filters) => db.accounts.findAll(filters),
      update: (id, updates) => db.accounts.update(id, updates),
      updateCursor: (id, streamType, cursor) => db.accounts.updateCursor(id, streamType, cursor),
    },

    importSessions: {
      create: (accountId) => db.importSessions.create(accountId),
      findLatestIncomplete: (accountId) => db.importSessions.findLatestIncomplete(accountId),
      update: (sessionId, updates) => {
        // Strip undefined values — exactOptionalPropertyTypes means the Kysely
        // Updateable type does not accept explicit undefined for status.
        const cleaned = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
        return db.importSessions.update(sessionId, cleaned);
      },
      finalize: (sessionId, { status, startTime, imported, skipped, errorMessage, metadata }) => {
        return db.importSessions.finalize(sessionId, status, startTime, imported, skipped, errorMessage, metadata);
      },
      findById: (sessionId) => db.importSessions.findById(sessionId),
    },

    rawTransactions: {
      createBatch: (accountId, transactions) => db.rawTransactions.createBatch(accountId, transactions),
      countByStreamType: (accountId) => db.rawTransactions.countByStreamType(accountId),
    },

    invalidateProjections: (accountIds, reason) =>
      resultDoAsync(async function* () {
        yield* await db.projectionState.markStale('processed-transactions', reason);
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

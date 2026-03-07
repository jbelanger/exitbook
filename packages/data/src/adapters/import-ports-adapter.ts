import type { ImportPorts } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to ingestion's ImportPorts.
 * Mirrors the pattern established by buildProcessingPorts.
 */
export function buildImportPorts(db: DataContext): ImportPorts {
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
      finalize: (sessionId, status, startTime, imported, skipped, errorMessage, metadata) => {
        // Port uses full status union; repo excludes 'started' (which the workflow never passes to finalize)
        const repoStatus = status as Exclude<typeof status, 'started'>;
        return db.importSessions.finalize(sessionId, repoStatus, startTime, imported, skipped, errorMessage, metadata);
      },
      findById: (sessionId) => db.importSessions.findById(sessionId),
    },

    rawTransactions: {
      createBatch: (accountId, transactions) =>
        db.executeInTransaction((tx) => tx.rawTransactions.createBatch(accountId, transactions)),
      countByStreamType: (accountId) => db.rawTransactions.countByStreamType(accountId),
    },
  };
}

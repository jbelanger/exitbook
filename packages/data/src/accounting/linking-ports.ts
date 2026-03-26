import type { ILinkingPersistence } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/foundation';

import type { DataSession } from '../data-session.js';

/**
 * Bridges DataSession repositories to accounting's ILinkingPersistence port.
 * Mirrors the pattern established by buildProcessingPorts and buildImportPorts.
 */
export function buildLinkingPorts(db: DataSession, profileId: number): ILinkingPersistence {
  return {
    loadTransactions: () => db.transactions.findAll({ profileId }),

    replaceLinks: (links) =>
      resultDoAsync(async function* () {
        const scopedAccounts = yield* await db.accounts.findAll({ profileId });
        const scopedAccountIds = scopedAccounts.map((account) => account.id);
        const previousCount = yield* await db.transactionLinks.count({ accountIds: scopedAccountIds });

        if (previousCount > 0) {
          yield* await db.transactionLinks.deleteByAccountIds(scopedAccountIds);
        }

        const savedCount = yield* await db.transactionLinks.createBatch(links);

        return { previousCount, savedCount };
      }),

    markLinksBuilding: () => db.projectionState.markBuilding('links'),

    // eslint-disable-next-line unicorn/no-null -- DB layer expects null for absent metadata
    markLinksFresh: () => db.projectionState.markFresh('links', null),

    markLinksFailed: () => db.projectionState.markFailed('links'),

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildLinkingPorts(txDb, profileId))),
  };
}

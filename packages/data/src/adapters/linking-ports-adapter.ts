import type { ILinkingPersistence } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's ILinkingPersistence port.
 * Mirrors the pattern established by buildProcessingPorts and buildImportPorts.
 */
export function buildLinkingPorts(db: DataContext): ILinkingPersistence {
  return {
    loadTransactions: () => db.transactions.findAll(),

    replaceMovements: (movements) =>
      resultDoAsync(async function* () {
        yield* await db.linkableMovements.deleteAll();
        yield* await db.linkableMovements.createBatch(movements);
        return yield* await db.linkableMovements.findAll();
      }),

    replaceLinks: (links) =>
      resultDoAsync(async function* () {
        const previousCount = yield* await db.transactionLinks.count();

        if (previousCount > 0) {
          yield* await db.transactionLinks.deleteAll();
        }

        const savedCount = yield* await db.transactionLinks.createBatch(links);

        return { previousCount, savedCount };
      }),

    markLinksBuilding: () => db.projectionState.markBuilding('links'),

    // eslint-disable-next-line unicorn/no-null -- DB layer expects null for absent metadata
    markLinksFresh: () => db.projectionState.markFresh('links', null),

    markLinksFailed: () => db.projectionState.markFailed('links'),

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildLinkingPorts(txDb))),
  };
}

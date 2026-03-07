import type { ILinkingPersistence } from '@exitbook/accounting/ports';
import { resultFromAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's ILinkingPersistence port.
 * Mirrors the pattern established by buildProcessingPorts and buildImportPorts.
 */
export function buildLinkingPorts(db: DataContext): ILinkingPersistence {
  return {
    loadTransactions: () => db.transactions.findAll(),

    replaceMovements: (movements) =>
      resultFromAsync(async function* () {
        yield* await db.linkableMovements.deleteAll();
        yield* await db.linkableMovements.createBatch(movements);
        return yield* await db.linkableMovements.findAll();
      }),

    replaceLinks: (links) =>
      resultFromAsync(async function* () {
        const previousCount = yield* await db.transactionLinks.count();

        if (previousCount > 0) {
          yield* await db.transactionLinks.deleteAll();
        }

        const savedCount = yield* await db.transactionLinks.createBatch(links);

        return { previousCount, savedCount };
      }),

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildLinkingPorts(txDb))),
  };
}

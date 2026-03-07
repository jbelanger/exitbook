import type { ILinkingPersistence } from '@exitbook/accounting/ports';
import { err, ok } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's ILinkingPersistence port.
 * Mirrors the pattern established by buildProcessingPorts and buildImportPorts.
 */
export function buildLinkingPorts(db: DataContext): ILinkingPersistence {
  return {
    loadTransactions: () => db.transactions.findAll(),

    replaceMovements: async (movements) => {
      const deleteResult = await db.linkableMovements.deleteAll();
      if (deleteResult.isErr()) return err(deleteResult.error);

      const saveResult = await db.linkableMovements.createBatch(movements);
      if (saveResult.isErr()) return err(saveResult.error);

      return db.linkableMovements.findAll();
    },

    replaceLinks: async (links) => {
      const countResult = await db.transactionLinks.count();
      if (countResult.isErr()) return err(countResult.error);
      const previousCount = countResult.value;

      if (previousCount > 0) {
        const deleteResult = await db.transactionLinks.deleteAll();
        if (deleteResult.isErr()) return err(deleteResult.error);
      }

      const saveResult = await db.transactionLinks.createBatch(links);
      if (saveResult.isErr()) return err(saveResult.error);

      return ok({ previousCount, savedCount: saveResult.value });
    },

    withTransaction: (fn) => db.executeInTransaction((txDb) => fn(buildLinkingPorts(txDb))),
  };
}

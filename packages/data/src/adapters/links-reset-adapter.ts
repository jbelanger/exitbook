import type { ILinksReset } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext to accounting's ILinksReset port.
 *
 * Owns only transaction_links.
 */
export function buildLinksResetPorts(db: DataContext): ILinksReset {
  return {
    async countResetImpact(accountIds) {
      return resultDoAsync(async function* () {
        const links = yield* await (accountIds
          ? db.transactionLinks.count({ accountIds })
          : db.transactionLinks.count());

        return { links };
      });
    },

    async reset(accountIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const links = yield* await (accountIds
            ? tx.transactionLinks.deleteByAccountIds(accountIds)
            : tx.transactionLinks.deleteAll());

          yield* await tx.projectionState.markStale('links', 'reset');

          return { links };
        })
      );
    },
  };
}

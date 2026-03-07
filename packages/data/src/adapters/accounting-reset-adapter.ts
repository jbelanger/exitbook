import type { IAccountingDataReset } from '@exitbook/accounting/ports';
import { resultDoAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's IAccountingDataReset port.
 * Deletes transaction_links and utxo_consolidated_movements (and future cost-basis tables).
 */
export function buildAccountingResetPorts(db: DataContext): IAccountingDataReset {
  return {
    async countResetImpact(accountIds) {
      return resultDoAsync(async function* () {
        const links = yield* await (accountIds
          ? db.transactionLinks.count({ accountIds })
          : db.transactionLinks.count());
        const consolidatedMovements = yield* await db.utxoConsolidatedMovements.count(
          accountIds ? { accountIds } : undefined
        );

        return {
          links,
          consolidatedMovements,
        };
      });
    },

    async resetDerivedData(accountIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          // FK-ordered: consolidated movements first, then links
          const consolidatedMovements = yield* await (accountIds
            ? tx.utxoConsolidatedMovements.deleteByAccountIds(accountIds)
            : tx.utxoConsolidatedMovements.deleteAll());
          const links = yield* await (accountIds
            ? tx.transactionLinks.deleteByAccountIds(accountIds)
            : tx.transactionLinks.deleteAll());

          return { links, consolidatedMovements };
        })
      );
    },
  };
}

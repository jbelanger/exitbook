import type { IAccountingDataReset } from '@exitbook/accounting/ports';
import { resultFromAsync } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's IAccountingDataReset port.
 * Deletes transaction_links and utxo_consolidated_movements (and future cost-basis tables).
 */
export function buildAccountingResetPorts(db: DataContext): IAccountingDataReset {
  return {
    async countResetImpact(accountIds) {
      return resultFromAsync(async function* () {
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
      return resultFromAsync(async function* (self) {
        const impact = yield* await self.countResetImpact(accountIds);

        return yield* await db.executeInTransaction(async (tx) =>
          resultFromAsync(async function* () {
            // FK-ordered: consolidated movements first, then links
            yield* await (accountIds
              ? tx.utxoConsolidatedMovements.deleteByAccountIds(accountIds)
              : tx.utxoConsolidatedMovements.deleteAll());
            yield* await (accountIds
              ? tx.transactionLinks.deleteByAccountIds(accountIds)
              : tx.transactionLinks.deleteAll());

            return impact;
          })
        );
      }, this);
    },
  };
}

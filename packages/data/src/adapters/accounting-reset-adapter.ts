import type { IAccountingDataReset } from '@exitbook/accounting/ports';
import { err, ok } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to accounting's IAccountingDataReset port.
 * Deletes transaction_links and utxo_consolidated_movements (and future cost-basis tables).
 */
export function buildAccountingResetPorts(db: DataContext): IAccountingDataReset {
  return {
    async countResetImpact(accountIds) {
      const linksResult = accountIds
        ? await db.transactionLinks.count({ accountIds })
        : await db.transactionLinks.count();
      if (linksResult.isErr()) return err(linksResult.error);

      const consolidatedResult = await db.utxoConsolidatedMovements.count(accountIds ? { accountIds } : undefined);
      if (consolidatedResult.isErr()) return err(consolidatedResult.error);

      return ok({
        links: linksResult.value,
        consolidatedMovements: consolidatedResult.value,
      });
    },

    async resetDerivedData(accountIds) {
      // Count before deleting for the result
      const impactResult = await this.countResetImpact(accountIds);
      if (impactResult.isErr()) return err(impactResult.error);
      const impact = impactResult.value;

      return db.executeInTransaction(async (tx) => {
        // FK-ordered: consolidated movements first, then links
        const consolidatedResult = accountIds
          ? await tx.utxoConsolidatedMovements.deleteByAccountIds(accountIds)
          : await tx.utxoConsolidatedMovements.deleteAll();
        if (consolidatedResult.isErr()) return err(consolidatedResult.error);

        const linksResult = accountIds
          ? await tx.transactionLinks.deleteByAccountIds(accountIds)
          : await tx.transactionLinks.deleteAll();
        if (linksResult.isErr()) return err(linksResult.error);

        return ok(impact);
      });
    },
  };
}

import { err, ok } from '@exitbook/core';
import type { IIngestionDataReset } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to ingestion's IIngestionDataReset port.
 * Deletes processed transactions and resets raw data processing status to pending.
 */
export function buildIngestionResetPorts(db: DataContext): IIngestionDataReset {
  return {
    async countResetImpact(accountIds) {
      const transactionsResult = accountIds
        ? await db.transactions.count({ accountIds, includeExcluded: true })
        : await db.transactions.count({ includeExcluded: true });
      if (transactionsResult.isErr()) return err(transactionsResult.error);

      return ok({ transactions: transactionsResult.value });
    },

    async resetDerivedData(accountIds) {
      const impactResult = await this.countResetImpact(accountIds);
      if (impactResult.isErr()) return err(impactResult.error);
      const impact = impactResult.value;

      return db.executeInTransaction(async (tx) => {
        const transactionsResult = accountIds
          ? await tx.transactions.deleteByAccountIds(accountIds)
          : await tx.transactions.deleteAll();
        if (transactionsResult.isErr()) return err(transactionsResult.error);

        // Reset all raw data to pending so reprocessing picks them up
        if (accountIds) {
          for (const accountId of accountIds) {
            const resetResult = await tx.rawTransactions.resetProcessingStatus({ accountId });
            if (resetResult.isErr()) return err(resetResult.error);
          }
        } else {
          const resetResult = await tx.rawTransactions.resetProcessingStatus();
          if (resetResult.isErr()) return err(resetResult.error);
        }

        return ok(impact);
      });
    },
  };
}

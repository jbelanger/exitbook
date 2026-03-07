import { resultDoAsync } from '@exitbook/core';
import type { IIngestionDataReset } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to ingestion's IIngestionDataReset port.
 * Deletes processed transactions and resets raw data processing status to pending.
 */
export function buildIngestionResetPorts(db: DataContext): IIngestionDataReset {
  return {
    async countResetImpact(accountIds) {
      return resultDoAsync(async function* () {
        const transactions = yield* await (accountIds
          ? db.transactions.count({ accountIds, includeExcluded: true })
          : db.transactions.count({ includeExcluded: true }));

        return { transactions };
      });
    },

    async resetDerivedData(accountIds) {
      return resultDoAsync(async function* (self) {
        const impact = yield* await self.countResetImpact(accountIds);

        return yield* await db.executeInTransaction(async (tx) =>
          resultDoAsync(async function* () {
            yield* await (accountIds ? tx.transactions.deleteByAccountIds(accountIds) : tx.transactions.deleteAll());

            // Reset all raw data to pending so reprocessing picks them up
            if (accountIds) {
              for (const accountId of accountIds) {
                yield* await tx.rawTransactions.resetProcessingStatus({ accountId });
              }
            } else {
              yield* await tx.rawTransactions.resetProcessingStatus();
            }

            return impact;
          })
        );
      }, this);
    },
  };
}

import { cascadeInvalidation, resultDoAsync } from '@exitbook/core';
import type { IProcessedTransactionsReset } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext to ingestion's IProcessedTransactionsReset port.
 *
 * Owns:
 * - transactions (processing output)
 * - utxo_consolidated_movements
 * - raw processing status reset back to pending
 */
export function buildProcessedTransactionsResetPorts(db: DataContext): IProcessedTransactionsReset {
  return {
    async countResetImpact(accountIds) {
      return resultDoAsync(async function* () {
        const transactions = yield* await (accountIds
          ? db.transactions.count({ accountIds, includeExcluded: true })
          : db.transactions.count({ includeExcluded: true }));
        const consolidatedMovements = yield* await db.utxoConsolidatedMovements.count(
          accountIds ? { accountIds } : undefined
        );

        return { transactions, consolidatedMovements };
      });
    },

    async reset(accountIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          // FK-ordered: consolidated movements first, then transactions
          const consolidatedMovements = yield* await (accountIds
            ? tx.utxoConsolidatedMovements.deleteByAccountIds(accountIds)
            : tx.utxoConsolidatedMovements.deleteAll());
          const transactions = yield* await (accountIds
            ? tx.transactions.deleteByAccountIds(accountIds)
            : tx.transactions.deleteAll());

          // Reset raw data to pending so reprocessing picks them up
          if (accountIds) {
            for (const accountId of accountIds) {
              yield* await tx.rawTransactions.resetProcessingStatus({ accountId });
            }
          } else {
            yield* await tx.rawTransactions.resetProcessingStatus();
          }

          // Mark this projection and all downstream projections stale
          yield* await tx.projectionState.markStale('processed-transactions', 'reset');
          for (const downstream of cascadeInvalidation('processed-transactions')) {
            yield* await tx.projectionState.markStale(downstream, 'upstream-reset:processed-transactions');
          }

          return { transactions, consolidatedMovements };
        })
      );
    },
  };
}

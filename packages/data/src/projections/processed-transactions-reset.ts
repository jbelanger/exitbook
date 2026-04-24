import { resultDoAsync } from '@exitbook/foundation';
import type { IProcessedTransactionsReset } from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';

import { buildProfileProjectionScopeKey, resolveAffectedProfileIds } from './profile-scope-key.js';
import { markDownstreamProjectionsStale } from './projection-invalidation.js';

/**
 * Bridges DataSession to ingestion's IProcessedTransactionsReset port.
 *
 * Owns:
 * - transactions (processing output)
 * - source activities and ledger journals/postings (shadow processing output)
 * - raw processing status reset back to pending
 */
export function buildProcessedTransactionsResetPorts(db: DataSession): IProcessedTransactionsReset {
  return {
    async countResetImpact(accountIds) {
      return resultDoAsync(async function* () {
        const transactions = yield* await (accountIds
          ? db.transactions.count({ accountIds, includeExcluded: true })
          : db.transactions.count({ includeExcluded: true }));
        const ledgerSourceActivities = yield* await db.accountingLedger.countSourceActivities(accountIds);

        return { ledgerSourceActivities, transactions };
      });
    },

    async reset(accountIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const transactions = yield* await (accountIds
            ? tx.transactions.deleteByAccountIds(accountIds)
            : tx.transactions.deleteAll());
          const ledgerSourceActivities = yield* await (accountIds
            ? tx.accountingLedger.deleteSourceActivitiesByAccountIds(accountIds)
            : tx.accountingLedger.deleteAllSourceActivities());

          // Reset raw data to pending so reprocessing picks them up
          if (accountIds) {
            for (const accountId of accountIds) {
              yield* await tx.rawTransactions.resetProcessingStatus({ accountId });
            }
          } else {
            yield* await tx.rawTransactions.resetProcessingStatus();
          }

          // Mark this projection and all downstream projections stale
          const profileIds = yield* await resolveAffectedProfileIds(tx, accountIds);
          for (const profileId of profileIds) {
            yield* await tx.projectionState.markStale(
              'processed-transactions',
              'reset',
              buildProfileProjectionScopeKey(profileId)
            );
          }
          yield* await markDownstreamProjectionsStale({
            accountIds,
            db: tx,
            from: 'processed-transactions',
            reason: 'upstream-reset:processed-transactions',
          });

          return { ledgerSourceActivities, transactions };
        })
      );
    },
  };
}

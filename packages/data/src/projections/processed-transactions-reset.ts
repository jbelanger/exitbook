import { resultDoAsync, type Result } from '@exitbook/foundation';
import { resolveAccountScopeAccountId, type IProcessedTransactionsReset } from '@exitbook/ingestion/ports';

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
        const ownerAccountIds = yield* await resolveOwnerAccountIds(db, accountIds);
        const ledgerSourceActivities = yield* await db.accountingLedger.countSourceActivities(ownerAccountIds);

        return { ledgerSourceActivities, transactions };
      });
    },

    async reset(accountIds) {
      return db.executeInTransaction(async (tx) =>
        resultDoAsync(async function* () {
          const transactions = yield* await (accountIds
            ? tx.transactions.deleteByAccountIds(accountIds)
            : tx.transactions.deleteAll());
          const ownerAccountIds = yield* await resolveOwnerAccountIds(tx, accountIds);
          let ledgerSourceActivities: number;
          if (ownerAccountIds === undefined) {
            ledgerSourceActivities = yield* await tx.accountingLedger.deleteAllSourceActivities();
          } else {
            ledgerSourceActivities =
              yield* await tx.accountingLedger.deleteSourceActivitiesByOwnerAccountIds(ownerAccountIds);
          }

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

async function resolveOwnerAccountIds(
  db: DataSession,
  accountIds: readonly number[] | undefined
): Promise<Result<number[] | undefined, Error>> {
  return resultDoAsync(async function* () {
    if (accountIds === undefined) {
      return undefined;
    }

    const ownerAccountIds = new Set<number>();
    const scopeCache = new Map<number, number>();

    for (const accountId of accountIds) {
      const account = yield* await db.accounts.getById(accountId);
      const ownerAccountId = yield* await resolveAccountScopeAccountId(
        account,
        {
          findById: (id) => db.accounts.findById(id),
        },
        {
          cache: scopeCache,
        }
      );
      ownerAccountIds.add(ownerAccountId);
    }

    return [...ownerAccountIds];
  });
}

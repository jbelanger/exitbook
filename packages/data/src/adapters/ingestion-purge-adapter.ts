import { resultDoAsync } from '@exitbook/core';
import type { IIngestionDataPurge } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to ingestion's IIngestionDataPurge port.
 * Deletes raw data, import sessions, and accounts. Requires re-import.
 *
 * Callers must ensure derived data (accounting + ingestion reset) is already
 * cleared before calling purge — otherwise FK constraints will fail.
 */
export function buildIngestionPurgePorts(db: DataContext): IIngestionDataPurge {
  return {
    async countPurgeImpact(accountIds) {
      return resultDoAsync(async function* () {
        const sessions = yield* await (accountIds
          ? db.importSessions.count({ accountIds })
          : db.importSessions.count());
        const rawData = yield* await (accountIds
          ? db.rawTransactions.count({ accountIds })
          : db.rawTransactions.count());

        return {
          accounts: accountIds ? accountIds.length : 0,
          sessions,
          rawData,
        };
      });
    },

    async purgeImportedData(accountIds) {
      return resultDoAsync(async function* (self) {
        const impact = yield* await self.countPurgeImpact(accountIds);

        return yield* await db.executeInTransaction(async (tx) =>
          resultDoAsync(async function* () {
            if (accountIds) {
              for (const accountId of accountIds) {
                yield* await tx.rawTransactions.deleteAll({ accountId });
                yield* await tx.importSessions.deleteBy({ accountId });
              }

              yield* await tx.accounts.deleteByIds(accountIds);
            } else {
              yield* await tx.rawTransactions.deleteAll();
              yield* await tx.importSessions.deleteBy();
            }

            return impact;
          })
        );
      }, this);
    },
  };
}

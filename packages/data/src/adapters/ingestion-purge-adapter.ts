import { err, ok } from '@exitbook/core';
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
      const sessionsResult = accountIds
        ? await db.importSessions.count({ accountIds })
        : await db.importSessions.count();
      if (sessionsResult.isErr()) return err(sessionsResult.error);

      const rawDataResult = accountIds
        ? await db.rawTransactions.count({ accountIds })
        : await db.rawTransactions.count();
      if (rawDataResult.isErr()) return err(rawDataResult.error);

      const accountsCount = accountIds ? accountIds.length : 0;

      return ok({
        accounts: accountsCount,
        sessions: sessionsResult.value,
        rawData: rawDataResult.value,
      });
    },

    async purgeImportedData(accountIds) {
      const impactResult = await this.countPurgeImpact(accountIds);
      if (impactResult.isErr()) return err(impactResult.error);
      const impact = impactResult.value;

      return db.executeInTransaction(async (tx) => {
        if (accountIds) {
          for (const accountId of accountIds) {
            const rawResult = await tx.rawTransactions.deleteAll({ accountId });
            if (rawResult.isErr()) return err(rawResult.error);

            const sessionResult = await tx.importSessions.deleteBy({ accountId });
            if (sessionResult.isErr()) return err(sessionResult.error);
          }

          const deleteAccountsResult = await tx.accounts.deleteByIds(accountIds);
          if (deleteAccountsResult.isErr()) return err(deleteAccountsResult.error);
        } else {
          const rawResult = await tx.rawTransactions.deleteAll();
          if (rawResult.isErr()) return err(rawResult.error);

          const sessionResult = await tx.importSessions.deleteBy();
          if (sessionResult.isErr()) return err(sessionResult.error);
        }

        return ok(impact);
      });
    },
  };
}

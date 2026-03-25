import { buildBalancesFreshnessPorts } from '@exitbook/data/balances';
import type { DataSession } from '@exitbook/data/session';
import { err, ok } from '@exitbook/foundation';

import type { AccountQueryPorts } from './account-query-ports.js';

export function buildAccountQueryPorts(db: DataSession): AccountQueryPorts {
  const balancesFreshness = buildBalancesFreshnessPorts(db);

  return {
    findAccountById: (id) => db.accounts.findById(id),
    findAccounts: (filters) => db.accounts.findAll(filters),
    countSessionsByAccount: (accountIds) => db.importSessions.countByAccount(accountIds),
    findSessions: (filters) => db.importSessions.findAll(filters),
    findBalanceSnapshots: async (scopeAccountIds) => {
      const snapshotsResult = await db.balanceSnapshots.findSnapshots(scopeAccountIds);
      if (snapshotsResult.isErr()) {
        return err(snapshotsResult.error);
      }

      return ok(new Map(snapshotsResult.value.map((snapshot) => [snapshot.scopeAccountId, snapshot])));
    },
    checkBalanceFreshness: (scopeAccountId) => balancesFreshness.checkFreshness(scopeAccountId),
  };
}

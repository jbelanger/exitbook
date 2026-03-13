import { err, ok } from '@exitbook/core';
import { buildBalancesFreshnessPorts } from '@exitbook/data';

import type { CommandDatabase } from '../../shared/command-runtime.js';

import type { AccountQueryPorts } from './account-query-ports.js';

export function buildAccountQueryPorts(db: CommandDatabase): AccountQueryPorts {
  const balancesFreshness = buildBalancesFreshnessPorts(db);

  return {
    users: {
      findOrCreateDefault: () => db.users.findOrCreateDefault(),
    },
    accounts: {
      findById: (id) => db.accounts.findByIdOptional(id),
      findAll: (filters) => db.accounts.findAll(filters),
    },
    importSessions: {
      countByAccount: (accountIds) => db.importSessions.countByAccount(accountIds),
      findAll: (filters) => db.importSessions.findAll(filters),
    },
    balanceSnapshots: {
      findSnapshots: async (scopeAccountIds) => {
        const snapshotsResult = await db.balanceSnapshots.findSnapshots(scopeAccountIds);
        if (snapshotsResult.isErr()) {
          return err(snapshotsResult.error);
        }

        return ok(new Map(snapshotsResult.value.map((snapshot) => [snapshot.scopeAccountId, snapshot])));
      },
    },
    balanceFreshness: {
      checkFreshness: (scopeAccountId) => balancesFreshness.checkFreshness(scopeAccountId),
    },
  };
}

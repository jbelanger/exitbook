import type { AccountQueryPorts } from '@exitbook/accounts/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to the accounts package's AccountQueryPorts.
 */
export function buildAccountQueryPorts(db: DataContext): AccountQueryPorts {
  return {
    users: {
      findOrCreateDefault: () => db.users.findOrCreateDefault(),
    },

    accounts: {
      findById: (id) => db.accounts.findById(id),
      findAll: (filters) => db.accounts.findAll(filters),
    },

    importSessions: {
      countByAccount: (accountIds) => db.importSessions.countByAccount(accountIds),
      findAll: (filters) => db.importSessions.findAll(filters),
    },
  };
}

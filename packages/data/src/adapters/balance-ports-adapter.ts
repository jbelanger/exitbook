import type { BalancePorts } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

/**
 * Bridges DataContext repositories to ingestion's BalancePorts.
 * This is the only place where the concrete data layer meets the balance workflow's ports.
 */
export function buildBalancePorts(db: DataContext): BalancePorts {
  return {
    accountLookup: {
      findById: (id) => db.accounts.findById(id),
      findChildAccounts: (parentAccountId) => db.accounts.findAll({ parentAccountId }),
    },
    accountUpdater: {
      updateVerification: (accountId, update) => db.accounts.update(accountId, update),
    },
    importSessionLookup: {
      findByAccountIds: (accountIds) => db.importSessions.findAll({ accountIds }),
    },
    transactionSource: {
      findByAccountIds: (params) => db.transactions.findAll(params),
    },
  };
}

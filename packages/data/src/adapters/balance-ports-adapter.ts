/* eslint-disable unicorn/no-null -- null needed for db */
import type { BalancePorts } from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

import { toBalanceScopeKey } from './balance-scope-utils.js';

/**
 * Bridges DataContext repositories to ingestion's BalancePorts.
 * This is the only place where the concrete data layer meets the balance workflow's ports.
 */
export function buildBalancePorts(db: DataContext): BalancePorts {
  return {
    accountLookup: {
      findById: (id) => db.accounts.findByIdOptional(id),
      findChildAccounts: (parentAccountId) => db.accounts.findAll({ parentAccountId }),
    },
    snapshotStore: {
      replaceSnapshot: ({ snapshot, assets }) => db.balanceSnapshots.replaceSnapshot({ snapshot, assets }),
    },
    projectionState: {
      markBuilding: (scopeAccountId) => db.projectionState.markBuilding('balances', toBalanceScopeKey(scopeAccountId)),
      markFailed: (scopeAccountId) => db.projectionState.markFailed('balances', toBalanceScopeKey(scopeAccountId)),
      markFresh: (scopeAccountId) => db.projectionState.markFresh('balances', null, toBalanceScopeKey(scopeAccountId)),
    },
    importSessionLookup: {
      findByAccountIds: (accountIds) => db.importSessions.findAll({ accountIds }),
    },
    transactionSource: {
      findByAccountIds: (params) => db.transactions.findAll(params),
    },
  };
}

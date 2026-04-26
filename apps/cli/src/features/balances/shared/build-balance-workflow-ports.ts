/* eslint-disable unicorn/no-null -- null needed for db */
import { toBalanceScopeKey } from '@exitbook/data/balances';
import type { DataSession } from '@exitbook/data/session';
import type { BalancePorts } from '@exitbook/ingestion/ports';

export function buildBalanceWorkflowPorts(db: DataSession): BalancePorts {
  return {
    findById: db.accounts.findById.bind(db.accounts),
    findChildAccounts: (parentAccountId) => db.accounts.findAll({ parentAccountId }),
    replaceSnapshot: db.balanceSnapshots.replaceSnapshot.bind(db.balanceSnapshots),
    markBuilding: (scopeAccountId) => db.projectionState.markBuilding('balances', toBalanceScopeKey(scopeAccountId)),
    markFailed: (scopeAccountId) => db.projectionState.markFailed('balances', toBalanceScopeKey(scopeAccountId)),
    markFresh: (scopeAccountId) => db.projectionState.markFresh('balances', null, toBalanceScopeKey(scopeAccountId)),
    findByAccountIds: (accountIds) => db.importSessions.findAll({ accountIds }),
    findAssetReviewSummariesByAssetIds: db.assetReview.getByAssetIds.bind(db.assetReview),
    findTransactionsByAccountIds: db.transactions.findAll.bind(db.transactions),
  };
}

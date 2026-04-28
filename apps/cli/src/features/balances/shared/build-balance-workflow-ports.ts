/* eslint-disable unicorn/no-null -- null needed for db */
import { buildLedgerBalancesFromPostings, type LedgerBalancePostingInput } from '@exitbook/accounting/ledger-balance';
import { toBalanceScopeKey } from '@exitbook/data/balances';
import type { DataSession } from '@exitbook/data/session';
import { err, ok } from '@exitbook/foundation';
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
    findLedgerBalanceRowsByOwnerAccountId: async (ownerAccountId) => {
      const postingsResult = await db.accountingLedger.findPostingsByOwnerAccountId(ownerAccountId);
      if (postingsResult.isErr()) {
        return err(postingsResult.error);
      }

      const ledgerResult = buildLedgerBalancesFromPostings(
        postingsResult.value.map(
          (posting): LedgerBalancePostingInput => ({
            ownerAccountId: posting.ownerAccountId,
            assetId: posting.assetId,
            assetSymbol: posting.assetSymbol,
            balanceCategory: posting.balanceCategory,
            quantity: posting.quantity,
            journalFingerprint: posting.journalFingerprint,
            postingFingerprint: posting.postingFingerprint,
            sourceActivityFingerprint: posting.sourceActivityFingerprint,
          })
        )
      );
      if (ledgerResult.isErr()) {
        return err(ledgerResult.error);
      }

      return ok(
        ledgerResult.value.balances.map((balance) => ({
          assetId: balance.assetId,
          assetSymbol: balance.assetSymbol,
          balanceCategory: balance.balanceCategory,
          quantity: balance.quantity.toFixed(),
        }))
      );
    },
    findTransactionsByAccountIds: db.transactions.findAll.bind(db.transactions),
  };
}

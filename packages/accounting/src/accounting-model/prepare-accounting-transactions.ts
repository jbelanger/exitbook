import type { Transaction } from '@exitbook/core';
import { resultDo, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';

export type {
  PreparedAccountingBuildResult,
  PreparedAccountingTransaction,
  InternalTransferCarryoverDraft,
  InternalTransferCarryoverDraftTarget,
  PreparedFeeMovement,
} from './prepared-accounting-types.js';

import { applySameHashDecisionToPreparedTransactions } from './preparation/apply-same-hash-decision.js';
import { clonePreparedAccountingTransaction } from './preparation/clone-prepared-accounting-transaction.js';
import { groupSameHashTransactionsForPreparation } from './preparation/group-same-hash-prepared-assets.js';
import { reduceSameHashGroupForPreparation } from './preparation/reduce-same-hash-prepared-group.js';
import type {
  PreparedAccountingBuildResult,
  PreparedAccountingTransaction,
  InternalTransferCarryoverDraft,
} from './prepared-accounting-types.js';

/**
 * Build the prepared accounting result from processed transactions.
 *
 * This prepared result is the seam for later accounting exclusions: callers can
 * remove prepared movements, assets, or fees after this build step and before
 * price validation or lot matching, without reopening matcher-local UTXO logic.
 */
export function prepareAccountingTransactions(
  transactions: Transaction[],
  logger: Logger
): Result<PreparedAccountingBuildResult, Error> {
  return resultDo(function* () {
    const preparedByTxId = new Map<number, PreparedAccountingTransaction>();
    for (const transaction of transactions) {
      preparedByTxId.set(transaction.id, clonePreparedAccountingTransaction(transaction));
    }

    const groups = yield* groupSameHashTransactionsForPreparation(transactions, preparedByTxId);
    const internalTransferCarryoverDrafts: InternalTransferCarryoverDraft[] = [];

    for (const group of groups) {
      const decision = yield* reduceSameHashGroupForPreparation(group, logger);
      if (decision === undefined) continue;

      yield* applySameHashDecisionToPreparedTransactions(
        preparedByTxId,
        internalTransferCarryoverDrafts,
        decision,
        logger
      );
    }

    return {
      inputTransactions: transactions,
      transactions: [...preparedByTxId.values()],
      internalTransferCarryoverDrafts,
    };
  });
}

import type { AssetMovement, FeeMovement, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

export interface PreparedFeeMovement extends FeeMovement {
  originalTransactionId: number;
}

export interface PreparedAccountingTransaction {
  tx: Transaction;
  /**
   * Raw transaction ids that must accompany this prepared transaction when
   * rebuilding after price filtering, because same-hash reduction consumed
   * sibling rows to produce the current prepared shape.
   */
  rebuildDependencyTransactionIds: number[];
  movements: {
    inflows: AssetMovement[];
    outflows: AssetMovement[];
  };
  fees: PreparedFeeMovement[];
}

export interface InternalTransferCarryoverDraftTarget {
  targetTransactionId: number;
  targetMovementFingerprint: string;
  quantity: Decimal;
}

export interface InternalTransferCarryoverDraft {
  assetId: string;
  assetSymbol: Currency;
  fee: PreparedFeeMovement;
  retainedQuantity: Decimal;
  sourceTransactionId: number;
  sourceMovementFingerprint: string;
  targets: InternalTransferCarryoverDraftTarget[];
}

export interface PreparedAccountingBuildResult {
  inputTransactions: Transaction[];
  transactions: PreparedAccountingTransaction[];
  internalTransferCarryoverDrafts: InternalTransferCarryoverDraft[];
}
